import { useState, useEffect } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, cached, attempt, formatDate, showModal, closeModal } from '../ui.js';
import { useSession, isDiscordUser } from '../session.js';
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
];

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
export const answerText = (field, v) => (v == null || v === '' ? '—' : field.type === 'checkbox' ? (v === 'true' ? '✓ tak' : '—') : String(v));

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
  } else if (my.status === 'accepted') action = html`<span class="signup-state st-accepted">✓ Zgłoszenie przyjęte${season ? ` — jesteś w rezerwie: ${season.name}` : ''}</span>`;
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

/** Okno z formularzem zgłoszenia (pola z ogłoszenia). */
function SignupModal({ post, season, account, my, onSaved, onClose }) {
  const fields = post.form_fields || [];
  const [answers, setAnswers] = useState(() => ({ ...(my?.answers || {}) }));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const set = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const list = await attempt(() => db.rpc('signup_submit', { p_post: post.id, p_answers: answers }), my ? 'Zgłoszenie poprawione' : 'Zgłoszenie wysłane — dziękujemy!');
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
        ${fields.map((f) => (f.type === 'checkbox'
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
