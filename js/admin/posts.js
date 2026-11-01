import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, attempt, formatDate } from '../ui.js';
import { useSession, userLabel } from '../session.js';
import { ImageField, DateTimeInput, toLocalInput, fromLocalInput, SERIES } from './common.js';
import { sortPosts, PostBody } from '../pages/announcements.js';
import { FIELD_TYPES, newFieldId, formOpen, timeLeft, seasonLabel, signupsPurgeAt } from '../pages/signup.js';
import { SignupsAdmin } from './signups.js';
import { PollResults } from '../pages/poll.js';

// Ogłoszenia na stronie głównej (moderator i wyżej): tytuł, zdjęcie, treść, przypięcie i opcjonalnie dodatek:
// formularz zgłoszeń (własny albo link do zewnętrznego) do wybranego sezonu / wydarzenia albo głosowanie (ankieta).

const EMPTY = { title: '', body: '', image_url: null, pinned: false };

// pola proponowane przy włączeniu własnego formularza (można je zmienić albo usunąć)
const DEFAULT_FIELDS = () => [
  { id: newFieldId(), label: 'Preferowany numer startowy', type: 'number', required: false },
  { id: newFieldId(), label: 'Doświadczenie (ligi, sim racing)', type: 'longtext', required: false },
  { id: newFieldId(), label: 'Akceptuję regulamin ligi', type: 'checkbox', required: true },
];

/** Domyślny koniec zgłoszeń: za tydzień, 20:00. */
function defaultUntil() {
  const d = new Date(Date.now() + 7 * 86400000);
  d.setHours(20, 0, 0, 0);
  return d.toISOString();
}

export function PostsAdmin({ parts = [] }) {
  if (parts[1]) return html`<${SignupsAdmin} key=${parts[1]} postId=${parts[1]} />`;
  return html`<${PostsList} />`;
}

function PostsList() {
  const [editing, setEditing] = useState(null); // id posta albo 'new'
  const data = useAsync(async () => {
    const [posts, signups, seasons] = await Promise.all([
      db.list('posts', { order: ['created_at', false] }),
      db.list('signups').catch(() => []), // tabela dochodzi w aktualizacji bazy
      db.list('seasons', { order: ['created_at', false] }),
    ]);
    return { posts, signups, seasons };
  }, []);
  if (data.loading && !data.data) return html`<${Loader} />`;
  if (data.error) {
    return html`<div class="hint warn">Ogłoszenia wymagają aktualizacji bazy: uruchom w Supabase → SQL Editor plik <b>supabase/migrations/2026-10-30_inne_lobby_ogloszenia.sql</b> (niczego nie usuwa).</div><${ErrorBox} error=${data.error} />`;
  }
  const { signups, seasons } = data.data;
  const posts = sortPosts(data.data.posts);
  const done = () => {
    setEditing(null);
    data.reload();
  };

  return html`
    <div class="season-bar">
      <div class="season-bar-title"><span class="eyebrow">Strona główna</span><b class="season-switch-static">Ogłoszenia</b></div>
      ${editing !== 'new' ? html`<button class="btn btn-accent btn-sm" onClick=${() => setEditing('new')}>+ Nowe ogłoszenie</button>` : null}
    </div>
    <p class="muted">Ogłoszenia są widoczne w bloku <b>„Ogłoszenia”</b> na górze strony głównej — przypięte na początku, potem od najnowszych.
      Ogłoszenie z formularzem zgłoszeń jest na stronie głównej do końca zapisów, a z głosowaniem — jeszcze 7 dni po jego zakończeniu (z wynikami). Gdy nie ma żadnego ogłoszenia, blok się nie wyświetla.</p>
    ${editing === 'new' ? html`<${PostEditor} post=${EMPTY} seasons=${seasons} onDone=${done} onCancel=${() => setEditing(null)} />` : null}
    <div class="post-admin-list">
      ${posts.map((p) => (editing === p.id
        ? html`<${PostEditor} key=${p.id} post=${p} seasons=${seasons} count=${signups.filter((x) => x.post_id === p.id).length} onDone=${done} onCancel=${() => setEditing(null)} />`
        : html`<${PostRow} key=${p.id} post=${p} seasons=${seasons} signups=${signups.filter((x) => x.post_id === p.id)} onEdit=${() => setEditing(p.id)} reload=${data.reload} />`))}
      ${!posts.length && editing !== 'new' ? html`<p class="muted">Brak ogłoszeń.</p>` : null}
    </div>
  `;
}

function PostRow({ post, seasons, signups, onEdit, reload }) {
  const togglePin = async () => (await attempt(() => db.update('posts', post.id, { pinned: !post.pinned }), post.pinned ? 'Odpięto' : 'Przypięto')) && reload();
  const remove = async () => {
    const extra = signups.length ? ` Razem z nim znikną zgłoszenia (${signups.length}).` : '';
    if (!confirm(`Usunąć ogłoszenie „${post.title}”?${extra}`)) return;
    if (await attempt(() => db.remove('posts', post.id), 'Ogłoszenie usunięte')) reload();
  };
  const open = formOpen(post);
  const season = seasons.find((s) => s.id === post.form_season_id);
  const pending = signups.filter((x) => x.status === 'pending').length;
  return html`<div class="post-admin">
    ${post.image_url ? html`<img class="post-admin-img" src=${post.image_url} alt="" />` : null}
    <div class="post-admin-main">
      <div class="muted small">${post.pinned ? '📌 Przypięte · ' : ''}${formatDate(post.created_at)}${post.author ? ` · ${post.author}` : ''}</div>
      <b>${post.title}</b>
      ${post.form_kind === 'poll' ? html`<${PollRowInfo} post=${post} />` : post.form_kind ? html`<div class="post-form-info small">
        <span class=${`tile-state ${open ? 'st-live' : 'st-done'}`}>${open ? 'Zapisy trwają' : 'Zapisy zakończone'}</span>
        ${post.form_kind === 'external' ? ' Formularz zewnętrzny' : ' Własny formularz'}${season ? ` · ${seasonLabel(season)}` : ''}${post.form_until ? ` · do ${formatDate(post.form_until)}${open ? ` (${timeLeft(post.form_until)})` : ''}` : ''}
        ${open ? null : html`<span class="muted"> · nie jest już na stronie głównej${post.form_kind === 'internal' && post.form_until ? ` · zgłoszenia znikną ${formatDate(signupsPurgeAt(post), false)}` : ''}</span>`}
      </div>` : null}
      <div class="post-clamp small"><${PostBody} text=${post.body} /></div>
    </div>
    <div class="post-admin-actions">
      ${post.form_kind === 'internal' ? html`<a class=${`btn btn-sm ${pending ? 'btn-accent' : ''}`} href=${`#/admin/ogloszenia/${post.id}`}>📝 Zgłoszenia (${signups.length})${pending ? ` · ${pending} nowe` : ''}</a>` : null}
      <button class="btn btn-sm" onClick=${onEdit}>Edytuj</button>
      <button class="btn btn-sm" onClick=${togglePin}>${post.pinned ? 'Odepnij' : '📌 Przypnij'}</button>
      <button class="btn btn-sm btn-danger" onClick=${remove}>Usuń</button>
    </div>
  </div>`;
}

function PostEditor({ post, seasons, count = 0, onDone, onCancel }) {
  const s = useSession();
  const [f, setF] = useState({
    title: post.title, body: post.body || '', image_url: post.image_url || null, pinned: !!post.pinned,
    form_kind: post.form_kind || '', form_url: post.form_url || '', form_fields: post.form_fields || [],
    form_season_id: post.form_season_id || '', form_until: toLocalInput(post.form_until || null),
    poll_multi: !!post.poll_multi,
  });
  // odpowiedzi głosowania trzymamy osobno od pól formularza (przełączanie rodzaju ich nie miesza)
  const [options, setOptions] = useState(() => (post.form_kind === 'poll' ? post.form_fields || [] : []));
  const [busy, setBusy] = useState(false);
  const isNew = !post.id;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setKind = (kind) => {
    if (kind === 'poll' && !options.length) setOptions([{ id: newFieldId(), label: '' }, { id: newFieldId(), label: '' }]);
    setKindF(kind);
  };
  const setKindF = (kind) => setF((x) => ({
    ...x, form_kind: kind,
    form_fields: kind === 'internal' && (!x.form_fields.length || post.form_kind === 'poll') ? DEFAULT_FIELDS() : x.form_fields,
    form_until: kind && !x.form_until ? toLocalInput(defaultUntil()) : x.form_until,
  }));
  const save = async (e) => {
    e.preventDefault();
    const row = { title: f.title.trim(), body: f.body.trim(), image_url: f.image_url, pinned: f.pinned };
    if (!row.title) return alert('Podaj tytuł ogłoszenia');
    // kolumny formularza wysyłamy tylko, gdy formularz jest (albo był) — ogłoszenia działają też bez aktualizacji bazy
    if (f.form_kind || post.form_kind) {
      if (f.form_kind) {
        if (!f.form_until) return alert(f.form_kind === 'poll' ? 'Ustaw, do kiedy trwa głosowanie' : 'Ustaw, do kiedy przyjmujesz zgłoszenia');
        if (f.form_kind === 'poll' && options.filter((x) => x.label.trim()).length < 2) return alert('Głosowanie musi mieć co najmniej dwie odpowiedzi');
        if (f.form_kind === 'external' && !/^https?:\/\//i.test(f.form_url.trim())) return alert('Podaj pełny adres formularza, np. https://forms.gle/…');
        if (f.form_kind === 'internal' && !f.form_season_id) return alert('Wybierz sezon / wydarzenie — przyjęci kierowcy trafią do jego rezerwy');
        if (f.form_kind === 'internal' && f.form_fields.some((x) => !x.label.trim())) return alert('Każde pole formularza musi mieć nazwę');
        if (f.form_fields.some((x) => x.type === 'select' && !(x.options || []).length)) return alert('Pole „Wybór z listy” musi mieć co najmniej jedną opcję');
      }
      Object.assign(row, {
        form_kind: f.form_kind || null,
        form_url: f.form_kind === 'external' ? f.form_url.trim() : null,
        form_fields: f.form_kind === 'internal' ? f.form_fields.map((x) => ({ ...x, label: x.label.trim() }))
          : f.form_kind === 'poll' ? options.filter((x) => x.label.trim()).map((x) => ({ id: x.id, label: x.label.trim() })) : [],
        form_season_id: f.form_kind === 'poll' ? null : f.form_season_id || null,
        form_until: f.form_kind ? fromLocalInput(f.form_until) : null,
      });
      if (f.form_kind === 'poll' || post.form_kind === 'poll') row.poll_multi = f.form_kind === 'poll' && f.poll_multi;
    }
    setBusy(true);
    const ok = await attempt(() => (isNew
      ? db.insert('posts', { ...row, author: userLabel(s.user, s.account) || null })
      : db.update('posts', post.id, row)), isNew ? 'Ogłoszenie opublikowane' : 'Zapisano ogłoszenie');
    setBusy(false);
    if (ok) onDone();
  };
  const bySeries = Object.entries(SERIES).map(([id, label]) => [label, seasons.filter((x) => x.series === id)]).filter(([, list]) => list.length);

  return html`<form class="card post-editor" onSubmit=${save}>
    <h3>${isNew ? 'Nowe ogłoszenie' : 'Edycja ogłoszenia'}</h3>
    <div class="post-editor-grid">
      <div>
        <label class="field"><span>Tytuł</span><input required value=${f.title} onInput=${set('title')} maxlength="120" placeholder="np. Ruszają zapisy na serię F2" /></label>
        <label class="field"><span>Treść</span><textarea rows="7" value=${f.body} onInput=${set('body')} placeholder="Treść ogłoszenia. Linki (https://…) staną się klikalne."></textarea></label>
        <label class="check-inline"><input type="checkbox" checked=${f.pinned} onChange=${set('pinned')} /> 📌 Przypnij na początku</label>
      </div>
      <div>
        <span class="field-label">Zdjęcie (opcjonalnie)</span>
        <${ImageField} kind="post" value=${f.image_url} onChange=${(url) => setF((x) => ({ ...x, image_url: url }))} />
      </div>
    </div>

    <div class="post-form-section">
      <span class="field-label">Dodatek do ogłoszenia</span>
      <div class="seg">
        ${[['', 'Bez dodatku'], ['internal', 'Formularz zgłoszeń'], ['external', 'Link do formularza'], ['poll', '📊 Głosowanie']].map(([id, label]) => html`<button type="button"
          class=${`btn btn-sm ${f.form_kind === id ? 'btn-accent' : ''}`} onClick=${() => setKind(id)}>${label}</button>`)}
      </div>
      ${f.form_kind === 'poll' ? html`<${PollEditor} f=${f} setF=${setF} options=${options} setOptions=${setOptions} />` : null}
      ${f.form_kind && f.form_kind !== 'poll' ? html`
        <p class="muted small">${f.form_kind === 'internal'
          ? 'Zgłaszają się osoby zalogowane przez Discord. Zgłoszenia przeglądasz w panelu (przycisk „Zgłoszenia” przy ogłoszeniu) — przyjęty kierowca trafia do rezerwy wybranego sezonu. Zgłoszenia są usuwane automatycznie 30 dni po zakończeniu zapisów.'
          : 'Przycisk w ogłoszeniu otworzy podany formularz (np. Google Forms, Microsoft Forms). Zgłoszenia zbierasz w tamtym serwisie.'} Ogłoszenie jest na stronie głównej do końca zgłoszeń.</p>
        <div class="form-grid">
          <label class="field"><span>Sezon / wydarzenie${f.form_kind === 'external' ? ' (opcjonalnie)' : ''}</span>
            <select value=${f.form_season_id} onChange=${set('form_season_id')}>
              <option value="">— wybierz —</option>
              ${bySeries.map(([label, list]) => html`<optgroup label=${label}>${list.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</optgroup>`)}
            </select></label>
          <label class="field"><span>Zgłoszenia do</span><${DateTimeInput} value=${f.form_until} onChange=${(v) => setF((x) => ({ ...x, form_until: v }))} /></label>
          ${f.form_kind === 'external' ? html`<label class="field span2"><span>Adres formularza</span>
            <input value=${f.form_url} onInput=${set('form_url')} placeholder="https://forms.gle/…" /></label>` : null}
        </div>
        ${f.form_kind === 'internal' ? html`
          ${count ? html`<p class="hint">Wysłano już ${count} zgłoszeń — zmiana pól nie zmienia ich odpowiedzi (usunięte pole zniknie z podglądu).</p>` : null}
          <${FieldsEditor} fields=${f.form_fields} onChange=${(list) => setF((x) => ({ ...x, form_fields: list }))} />` : null}
      ` : null}
    </div>

    <div class="form-actions">
      <button class="btn btn-accent" disabled=${busy}>${busy ? 'Zapisywanie…' : isNew ? 'Opublikuj' : 'Zapisz'}</button>
      <button type="button" class="btn" onClick=${onCancel}>Anuluj</button>
    </div>
  </form>`;
}

/** Głosowanie: odpowiedzi (min. 2), jedna albo kilka do wyboru, koniec głosowania. */
function PollEditor({ f, setF, options, setOptions }) {
  const patch = (i, label) => setOptions(options.map((x, j) => (j === i ? { ...x, label } : x)));
  return html`
    <p class="muted small">Pytanie do społeczności — wpisz je w tytule albo treści ogłoszenia. Głosują osoby zalogowane przez Discord
      (jeden głos na konto, do końca można go zmienić). Wyniki widać po oddaniu głosu i po zakończeniu; ogłoszenie zostaje
      na stronie głównej jeszcze 7 dni po zakończeniu, z wynikami.</p>
    <div class="form-grid">
      <label class="field"><span>Głosowanie do</span><${DateTimeInput} value=${f.form_until} onChange=${(v) => setF((x) => ({ ...x, form_until: v }))} /></label>
      <label class="check-inline"><input type="checkbox" checked=${f.poll_multi} onChange=${(e) => setF((x) => ({ ...x, poll_multi: e.target.checked }))} /> Można zaznaczyć kilka odpowiedzi</label>
    </div>
    <div class="fields-editor">
      <span class="field-label">Odpowiedzi</span>
      ${options.map((x, i) => html`<div class="poll-option-row" key=${x.id}>
        <span class="muted">${i + 1}.</span>
        <input value=${x.label} maxlength="120" placeholder=${i === 0 ? 'np. Spa-Francorchamps' : 'kolejna odpowiedź'} onInput=${(e) => patch(i, e.target.value)} />
        <button type="button" class="btn btn-xs btn-danger" disabled=${options.length <= 2} onClick=${() => setOptions(options.filter((_, j) => j !== i))} aria-label="Usuń odpowiedź">✕</button>
      </div>`)}
      <button type="button" class="btn btn-sm" onClick=${() => setOptions([...options, { id: newFieldId(), label: '' }])}>+ Dodaj odpowiedź</button>
    </div>`;
}

/** Głosowanie na liście ogłoszeń: stan, termin i bieżące wyniki (moderator widzi je zawsze). */
function PollRowInfo({ post }) {
  const open = formOpen(post);
  const st = useAsync(() => db.rpc('poll_state', { p_post: post.id }), [post.id]);
  return html`<div class="post-form-info small">
      <span class=${`tile-state ${open ? 'st-live' : 'st-done'}`}>${open ? 'Głosowanie trwa' : 'Głosowanie zakończone'}</span>
      ${post.poll_multi ? ' Wiele odpowiedzi' : ' Jedna odpowiedź'}${post.form_until ? ` · do ${formatDate(post.form_until)}${open ? ` (${timeLeft(post.form_until)})` : ''}` : ''}
      ${st.data?.results ? ` · zagłosowało: ${st.data.results.voters}` : ''}
    </div>
    ${st.data?.results ? html`<div class="poll-admin-results"><${PollResults} options=${post.form_fields || []} results=${st.data.results} /></div>` : null}
    ${st.error ? html`<div class="hint warn small">Głosowanie wymaga aktualizacji bazy (supabase/migrations/2026-11-02_glosowania.sql): ${st.error.message}</div>` : null}`;
}

/** Pola własnego formularza: nazwa, typ, wymagane, opcje listy; kolejność strzałkami. Nick i konto Discord dołączają się same. */
function FieldsEditor({ fields, onChange }) {
  const patch = (i, p) => onChange(fields.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i, d) => {
    const list = [...fields];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    onChange(list);
  };
  return html`<div class="fields-editor">
    <span class="field-label">Pola formularza <span class="muted">(nick i konto Discord dołączają się same)</span></span>
    ${fields.map((x, i) => html`<div class="form-field-row" key=${x.id}>
      <input class="ff-label" value=${x.label} placeholder="Nazwa pola, np. Numer startowy" onInput=${(e) => patch(i, { label: e.target.value })} />
      <select class="ff-type" value=${x.type} onChange=${(e) => patch(i, { type: e.target.value })}>
        ${FIELD_TYPES.map(([id, label]) => html`<option value=${id}>${label}</option>`)}
      </select>
      <label class="check-inline"><input type="checkbox" checked=${!!x.required} onChange=${(e) => patch(i, { required: e.target.checked })} /> wymagane</label>
      <span class="ff-buttons">
        <button type="button" class="btn btn-xs icon-btn" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label="W górę">↑</button>
        <button type="button" class="btn btn-xs icon-btn" disabled=${i === fields.length - 1} onClick=${() => move(i, 1)} aria-label="W dół">↓</button>
        <button type="button" class="btn btn-xs btn-danger" onClick=${() => onChange(fields.filter((_, j) => j !== i))} aria-label="Usuń pole">✕</button>
      </span>
      ${x.type === 'select' ? html`<input class="ff-options" value=${(x.options || []).join(', ')} placeholder="Opcje oddzielone przecinkami, np. PC, PlayStation, Xbox"
        onChange=${(e) => patch(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} />` : null}
    </div>`)}
    <button type="button" class="btn btn-sm" onClick=${() => onChange([...fields, { id: newFieldId(), label: '', type: 'text', required: false }])}>+ Dodaj pole</button>
  </div>`;
}
