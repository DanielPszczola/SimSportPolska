import { useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, cached, useAsync, attempt, formatDate, showModal, closeModal, TeamLogo, TeamCar } from '../ui.js';
import { useSession, isDiscordUser } from '../session.js';
import { prepareProof, blobToBase64 } from '../images.js';
import { carClass, CAR_CLASSES } from '../scoring.js';
import { DiscordButton } from './account.js';
import { PrivacyNote } from './privacy.js';

// Formularz zgłoszeń w ogłoszeniu: własny (pola ustawia moderator, zgłoszenia trafiają do panelu) albo link do zewnętrznego.
// Zgłaszają się tylko osoby zalogowane przez Discord; zasad pilnuje baza (signup_submit / signup_withdraw / my_signups).
// Formularz działa do form_until — do tego czasu ogłoszenie jest też na stronie głównej.

/** Typy pól formularza: [id, nazwa w panelu]. */
export const FIELD_TYPES = [
  ['text', 'Krótki tekst'],
  ['longtext', 'Dłuższy tekst'],
  ['number', 'Liczba'],
  ['select', 'Wybór z listy'],
  ['checkbox', 'Zaznaczenie (tak / nie)'],
  ['image', 'Zdjęcie (np. zrzut z gry)'],
  ['car', 'Wybór auta / zespołu'],
];

/** Pole „Wybór auta”: sugestia (nic nie blokuje — liga z weryfikacją) albo rezerwacja miejsca (event). */
export const CAR_MODES = [['suggest', 'Sugestia — nic nie blokuje'], ['reserve', 'Rezerwacja — wybór zajmuje miejsce']];
export const carMax = (field) => Math.max(1, Number(field.max) || 2);

/** Wolne miejsca w autach sezonu z formularza: Map(team_id -> { lineup, pending }). */
export const loadSeats = (postId) => db.rpc('signup_seats', { p_post: postId }).then((rows) => new Map((rows || []).map((r) => [r.team_id, r])), () => new Map());
export const freeSeats = (field, seat) => carMax(field) - (seat?.lineup || 0) - (field.mode === 'reserve' ? seat?.pending || 0 : 0);

export const newFieldId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Czy formularz przyjmuje zgłoszenia (wg daty końca). */
export const formOpen = (post, now = Date.now()) => !!post.form_kind && (!post.form_until || now < new Date(post.form_until).getTime());

/** Głosowanie zostaje na stronie głównej jeszcze tyle dni po zakończeniu — z wynikami. */
export const POLL_SHOW_DAYS = 7;

/** Ogłoszenie na stronie głównej: bez dodatku zawsze, z formularzem — do końca zgłoszeń, z głosowaniem — jeszcze tydzień po nim. */
export const postOnHome = (post, now = Date.now()) => !post.form_kind || formOpen(post, now)
  || (post.form_kind === 'poll' && now < new Date(post.form_until).getTime() + POLL_SHOW_DAYS * 86400000);

/** „jeszcze 3 dni” / „jeszcze 5 godz.” / „jeszcze 20 min”. */
export function timeLeft(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'zakończone';
  const d = Math.floor(ms / 86400000);
  if (d >= 1) return `jeszcze ${d} ${d === 1 ? 'dzień' : 'dni'}`;
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `jeszcze ${h} godz.` : `jeszcze ${Math.max(1, Math.round(ms / 60000))} min`;
}

const SERIES_SHORT = { f1: 'F1', lmu: 'LMU', inne: 'Event' };
export const seasonLabel = (s) => (s ? `${SERIES_SHORT[s.series] ?? ''} · ${s.name}` : '');
export const loadAllSeasons = () => cached('seasons:all', () => db.list('seasons', { order: ['created_at', false] }));

/** Zgłoszenia są usuwane automatycznie tyle dni po zakończeniu zapisów (funkcja signups_cleanup w bazie). */
export const SIGNUP_KEEP_DAYS = 30;
export const signupsPurgeAt = (post) => (post.form_until ? new Date(new Date(post.form_until).getTime() + SIGNUP_KEEP_DAYS * 86400000).toISOString() : null);

/** Odpowiedź do wyświetlenia. */
export const answerText = (field, v, teamName) => (v == null || v === '' ? '—'
  : field.type === 'checkbox' ? (v === 'true' ? '✓ tak' : '—')
    : field.type === 'image' ? 'zdjęcie w panelu'
      : field.type === 'car' ? (teamName ? teamName(v) ?? 'auto spoza listy sezonu' : 'wybrane auto') : String(v));

/** Zdjęcie ze zgłoszenia (widzi je autor i moderatorzy): pobierane, gdy jest blisko ekranu; klik powiększa na całą stronę. */
export function ProofImage({ signupId, fieldId }) {
  const ref = useRef(null);
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!zoom) return undefined;
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // Esc zamyka powiększenie, nie okno formularza pod spodem
      setZoom(false);
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [zoom]);
  useEffect(() => {
    let alive = true;
    let url = null;
    const load = async () => {
      try {
        const f = await db.rpc('signup_file', { p_signup: signupId, p_field: fieldId });
        if (!f) throw new Error('brak pliku');
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
        if (alive) setSrc(url);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    const seen = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      seen.disconnect();
      load();
    }, { rootMargin: '300px' });
    seen.observe(ref.current);
    return () => {
      alive = false;
      seen.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [signupId, fieldId]);
  return html`<div class="proof-image" ref=${ref}>
    ${src ? html`<button type="button" class="proof-thumb" onClick=${() => setZoom(true)} title="Powiększ"><img src=${src} alt="Załączone zdjęcie" /></button>`
      : html`<span class="muted small">${error ? `Nie udało się wczytać zdjęcia: ${error}` : 'Ładowanie zdjęcia…'}</span>`}
    ${zoom ? html`<div class="proof-zoom" onClick=${() => setZoom(false)} title="Zamknij"><img src=${src} alt="Powiększone zdjęcie" /></div>` : null}
  </div>`;
}

const loadMine = (uid) => cached(`signups:${uid}`, () => db.rpc('my_signups').catch(() => []));

/** Blok zgłoszeń w karcie ogłoszenia. */
export function SignupBox({ post }) {
  const s = useSession();
  const [seasons, setSeasons] = useState([]);
  const [mine, setMine] = useState(null);
  const discord = isDiscordUser(s.user);
  useEffect(() => { loadAllSeasons().then(setSeasons, () => {}); }, []);
  useEffect(() => {
    if (discord && post.form_kind === 'internal') loadMine(s.user.id).then(setMine);
    else setMine(null);
  }, [s.user?.id, discord]);

  const open = formOpen(post);
  const season = seasons.find((x) => x.id === post.form_season_id);
  const my = (mine || []).find((x) => x.post_id === post.id);
  const openForm = () => showModal(html`<${SignupModal} key=${post.id} post=${post} season=${season} account=${s.account} my=${my}
    onSaved=${(list) => { setMine(list); closeModal(); }} onClose=${closeModal} />`);
  const withdraw = async () => {
    if (!confirm('Wycofać zgłoszenie?')) return;
    const list = await attempt(() => db.rpc('signup_withdraw', { p_post: post.id }), 'Zgłoszenie wycofane');
    if (list) setMine(list);
  };

  let action = null;
  if (!open) action = html`<span class="muted">Zgłoszenia zamknięte</span>`;
  else if (post.form_kind === 'external') {
    action = post.form_url ? html`<a class="btn btn-accent" href=${post.form_url} target="_blank" rel="noopener">📝 Formularz zgłoszeń ↗</a>` : null;
  } else if (!s.ready) action = null;
  else if (!s.user) action = html`<${DiscordButton} label="Zaloguj przez Discord, aby się zgłosić" /><${PrivacyNote} />`;
  else if (!discord) action = html`<span class="muted small">Zgłoszenia przyjmujemy od kont Discord — zaloguj się przez Discord.</span>`;
  else if (!mine) action = null;
  else if (!my) action = html`<button type="button" class="btn btn-accent" onClick=${openForm}>📝 Zgłoś się</button>`;
  else if (my.status === 'pending') {
    action = html`<span class="signup-state st-pending">✓ Zgłoszenie wysłane — czeka na decyzję</span>
      <button type="button" class="btn btn-sm" onClick=${openForm}>Popraw</button>
      <button type="button" class="btn btn-sm" onClick=${withdraw}>Wycofaj</button>`;
  } else if (my.status === 'accepted') {
    action = html`<span class="signup-state st-accepted">✓ Zgłoszenie przyjęte${my.team_name ? ` — jesteś w składzie: ${my.team_name}${season ? ` (${season.name})` : ''}`
      : season ? ` — jesteś w rezerwie: ${season.name}` : ''}</span>`;
  }
  else action = html`<span class="signup-state st-rejected">Zgłoszenie nie zostało przyjęte</span>`;

  return html`<div class=${`signup-box ${open ? '' : 'closed'}`}>
    <div class="signup-meta">
      <b>📝 Zapisy${season ? `: ${seasonLabel(season)}` : ''}</b>
      ${post.form_until ? html`<span class="muted small">do ${formatDate(post.form_until)} · ${timeLeft(post.form_until)}</span>` : null}
    </div>
    <div class="signup-actions">${action}
      ${s.isStaff && post.form_kind === 'internal' ? html`<a class="btn btn-sm" href=${`#/admin/ogloszenia/${post.id}`}>Zgłoszenia w panelu →</a>` : null}
    </div>
  </div>`;
}

/** Pole „Wybór auta / zespołu”: kafelki aut sezonu z formularza (logo, nazwa, bolid, miejsca, kto już jedzie).
 *  Zajęte auta są wyszarzone; w trybie rezerwacji nie da się ich wybrać, w trybie sugestii — tylko jako propozycję. */
function CarField({ field, post, value, onChange }) {
  const data = useAsync(async () => {
    const [teams, seats, entries] = await Promise.all([
      db.list('teams', { eq: { season_id: post.form_season_id } }), loadSeats(post.id),
      db.list('entries', { eq: { season_id: post.form_season_id } }).catch(() => []),
    ]);
    const seated = entries.filter((e) => e.team_id && !e.is_reserve);
    const drivers = await db.list('drivers', { in: { id: [...new Set(seated.map((e) => e.driver_id))] } }).catch(() => []);
    const nick = new Map(drivers.map((d) => [d.id, d.nick]));
    const crew = new Map();
    for (const e of seated) crew.set(e.team_id, [...(crew.get(e.team_id) || []), nick.get(e.driver_id)].filter(Boolean));
    // kolejność klas jak w wynikach: Hypercar, LMP, GT3, potem własne klasy wydarzenia, na końcu auta bez klasy
    const rank = (c) => (!c ? 1e3 : CAR_CLASSES.some((x) => x.id === c) ? -CAR_CLASSES.findIndex((x) => x.id === c) : 100);
    teams.sort((a, b) => rank(a.car_class) - rank(b.car_class) || String(a.car_class ?? '').localeCompare(String(b.car_class ?? '')) || a.name.localeCompare(b.name) || String(a.created_at).localeCompare(String(b.created_at)));
    // ta sama nazwa kilka razy (np. dwa takie same auta) → numer przy nazwie
    const count = new Map(), seen = new Map();
    for (const t of teams) count.set(t.name, (count.get(t.name) || 0) + 1);
    const label = new Map(teams.map((t) => { const n = (seen.get(t.name) || 0) + 1; seen.set(t.name, n); return [t.id, count.get(t.name) > 1 ? `${t.name} #${n}` : t.name]; }));
    return { teams, seats, crew, label };
  }, [post.id]);
  const reserve = field.mode === 'reserve';
  const max = carMax(field);
  const d = data.data;
  const teams = d?.teams || [];
  const classes = [...new Set(teams.map((t) => t.car_class || ''))];

  const tile = (t) => {
    const seat = d.seats.get(t.id);
    const taken = Math.min(max, (seat?.lineup || 0) + (reserve ? seat?.pending || 0 : 0));
    const mine = t.id === value;
    const free = max - taken;
    const full = free <= 0 && !mine;
    const crew = d.crew.get(t.id) || [];
    const cls = t.car_class ? carClass(t.car_class) : null;
    return html`<button type="button" key=${t.id} class=${`car-pick ${mine ? 'is-picked' : ''} ${full ? 'is-full' : ''}`} style=${{ '--team': t.color || '#888' }}
      disabled=${reserve && full} aria-pressed=${mine}
      title=${full ? (reserve ? 'Auto jest już zajęte' : 'Auto jest pełne — możesz je wskazać tylko jako propozycję') : ''}
      onClick=${() => onChange(mine && !field.required ? '' : t.id)}>
      <span class="car-pick-head">
        <${TeamLogo} team=${t} size=${32} />
        <b class="car-pick-name">${d.label.get(t.id)}</b>
        ${mine ? html`<span class="car-pick-check" aria-hidden="true">✓</span>` : null}
      </span>
      <span class="car-pick-img"><${TeamCar} team=${t} /></span>
      <span class="car-pick-foot">
        <span class="car-pick-seats" aria-label=${`zajęte ${taken} z ${max}`}>${Array.from({ length: max }, (_, k) => html`<i class=${k < taken ? 'on' : mine && k === taken ? 'me' : ''}></i>`)}</span>
        <span class="car-pick-state">${mine ? 'Twój wybór' : full ? 'Zajęte' : `wolne ${free} z ${max}`}</span>
        ${cls && classes.length === 1 ? html`<span class="class-badge" style=${{ '--cls': cls.color }}>${cls.label}</span>` : null}
      </span>
      ${crew.length ? html`<span class="car-pick-crew muted">Jadą: ${crew.join(', ')}</span>` : null}
    </button>`;
  };

  return html`<div class="field car-field" role="group" aria-label=${field.label}>
    <span>${field.label}${field.required ? html` <span class="req">*</span>` : null}</span>
    ${data.loading && !d ? html`<span class="muted small">Ładowanie aut…</span>`
      : !teams.length ? html`<span class="muted small">Organizatorzy nie dodali jeszcze aut do tego sezonu.</span>`
      : classes.length > 1
        ? classes.map((c) => html`<div class="car-pick-group" key=${c || '-'}>
            <h4>${c ? html`<span class="class-badge" style=${{ '--cls': carClass(c)?.color }}>${carClass(c)?.label ?? c}</span>` : 'Bez klasy'}</h4>
            <div class="car-pick-grid">${teams.filter((t) => (t.car_class || '') === c).map(tile)}</div>
          </div>`)
        : html`<div class="car-pick-grid">${teams.map(tile)}</div>`}
    <small class="muted">${reserve
      ? 'Kliknij auto — po wysłaniu zgłoszenia jest zarezerwowane dla Ciebie. Wyszarzonych (zajętych) aut nie można wybrać.'
      : 'Kliknij auto, którym chcesz jechać — to propozycja, ostateczny przydział ustalają organizatorzy.'}${field.required ? '' : ' Ponowne kliknięcie wybranego auta usuwa wybór.'}</small>
  </div>`;
}

/** Pole „Zdjęcie”: plik jest zmniejszany od razu po wybraniu, więc błąd i podgląd widać przed wysłaniem. */
function PhotoField({ field, signupId, saved, file, touched, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pick = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await prepareProof(picked);
      onChange({ url: URL.createObjectURL(blob), base64: await blobToBase64(blob) });
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const showSaved = saved && !touched;
  return html`<div class="field photo-field">
    <span>${field.label}${field.required ? html` <span class="req">*</span>` : null}</span>
    ${file ? html`<div class="proof-image"><img src=${file.url} alt="Podgląd zdjęcia" /></div>` : null}
    ${showSaved ? html`<${ProofImage} signupId=${signupId} fieldId=${field.id} />` : null}
    <div class="photo-actions">
      <label class="btn btn-sm">${busy ? 'Przygotowuję…' : file || showSaved ? 'Zmień zdjęcie' : '📷 Dodaj zdjęcie'}
        <input class="photo-input" type="file" accept="image/png,image/jpeg,image/webp" disabled=${busy} onChange=${pick} /></label>
      ${(file || showSaved) && !field.required ? html`<button type="button" class="btn btn-sm" onClick=${() => onChange(null)}>Usuń</button>` : null}
    </div>
    ${error ? html`<p class="hint warn">${error}</p>` : null}
    <small class="muted">Zdjęcie widzi tylko administracja ligi. Upewnij się, że nie ma na nim prywatnych danych.</small>
  </div>`;
}

/** Okno z formularzem zgłoszenia (pola z ogłoszenia). */
function SignupModal({ post, season, account, my, onSaved, onClose }) {
  const fields = post.form_fields || [];
  const [answers, setAnswers] = useState(() => ({ ...(my?.answers || {}) }));
  const [files, setFiles] = useState({}); // {id pola: { url, base64 } albo null = usuń dotychczasowe}
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const set = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));
  const hasFile = (f) => (f.id in files ? !!files[f.id] : my?.answers?.[f.id] === 'file');
  const submit = async (e) => {
    e.preventDefault();
    const missing = fields.find((f) => f.type === 'image' && f.required && !hasFile(f));
    if (missing) return alert(`Dodaj zdjęcie: ${missing.label}`);
    const noCar = fields.find((f) => f.type === 'car' && f.required && !answers[f.id]);
    if (noCar) return alert(`Wybierz auto: ${noCar.label}`);
    setBusy(true);
    const p_files = Object.fromEntries(Object.entries(files).map(([id, x]) => [id, x ? x.base64 : null]));
    const list = await attempt(() => db.rpc('signup_submit', { p_post: post.id, p_answers: answers, p_files }), my ? 'Zgłoszenie poprawione' : 'Zgłoszenie wysłane — dziękujemy!');
    setBusy(false);
    if (list) onSaved(list);
  };
  const input = (f) => {
    const v = answers[f.id] ?? '';
    if (f.type === 'longtext') return html`<textarea rows="4" maxlength="2000" required=${!!f.required} value=${v} onInput=${(e) => set(f.id, e.target.value)}></textarea>`;
    if (f.type === 'number') return html`<input type="number" required=${!!f.required} value=${v} onInput=${(e) => set(f.id, e.target.value)} />`;
    if (f.type === 'select') {
      return html`<select required=${!!f.required} value=${v} onChange=${(e) => set(f.id, e.target.value)}>
        <option value="">— wybierz —</option>
        ${(f.options || []).map((o) => html`<option value=${o}>${o}</option>`)}
      </select>`;
    }
    return html`<input maxlength="200" required=${!!f.required} value=${v} onInput=${(e) => set(f.id, e.target.value)} />`;
  };

  return html`<div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Formularz zgłoszenia">
      <header class="modal-head">
        <div><div class="eyebrow">📝 Zgłoszenie${season ? ` · ${seasonLabel(season)}` : ''}</div>
          <h3>${post.title}</h3>
          ${post.form_until ? html`<div class="muted small">Zgłoszenia do ${formatDate(post.form_until)}</div>` : null}</div>
        <button type="button" class="btn btn-sm" onClick=${onClose} aria-label="Zamknij">✕</button>
      </header>
      <form class="modal-body signup-form" onSubmit=${submit}>
        <p class="muted small">Zgłaszasz się jako <b>${account?.display_name || 'konto Discord'}</b>${account?.driver_nick ? html` (profil kierowcy: <b>${account.driver_nick}</b>)` : ''}.
          Do końca zapisów możesz poprawić albo wycofać zgłoszenie. Odpowiedzi widzi tylko administracja ligi — <a href="#/prywatnosc" target="_blank">polityka prywatności</a>.</p>
        ${fields.map((f) => (f.type === 'car'
          ? html`<${CarField} key=${f.id} field=${f} post=${post} value=${answers[f.id] ?? ''} onChange=${(v) => set(f.id, v)} />`
          : f.type === 'image'
          ? html`<${PhotoField} key=${f.id} field=${f} signupId=${my?.id} saved=${my?.answers?.[f.id] === 'file'} file=${files[f.id]} touched=${f.id in files}
              onChange=${(v) => setFiles((x) => ({ ...x, [f.id]: v }))} />`
          : f.type === 'checkbox'
          ? html`<label class="check-inline signup-check"><input type="checkbox" required=${!!f.required} checked=${answers[f.id] === 'true'} onChange=${(e) => set(f.id, e.target.checked ? 'true' : '')} />
              ${f.label}${f.required ? html` <span class="req">*</span>` : null}</label>`
          : html`<label class="field"><span>${f.label}${f.required ? html` <span class="req">*</span>` : null}</span>${input(f)}</label>`))}
        <div class="form-actions">
          <button class="btn btn-accent" disabled=${busy}>${busy ? 'Wysyłanie…' : my ? 'Zapisz poprawki' : 'Wyślij zgłoszenie'}</button>
          <button type="button" class="btn" onClick=${onClose}>Anuluj</button>
        </div>
      </form>
    </div>
  </div>`;
}
