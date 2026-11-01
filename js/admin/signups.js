import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, attempt, formatDate } from '../ui.js';
import { formOpen, timeLeft, seasonLabel, answerText, signupsPurgeAt, SIGNUP_KEEP_DAYS } from '../pages/signup.js';

// Zgłoszenia z formularza w ogłoszeniu (moderator i wyżej): podgląd odpowiedzi, przyjęcie albo odrzucenie.
// Przyjęcie dodaje kierowcę do rezerwy sezonu z formularza (bez konta kierowcy — tworzy profil z nickiem z Discorda);
// cofnięcie przyjęcia zdejmuje go z rezerwy, o ile nie dostał jeszcze miejsca w zespole ani nie ma wyników.

const STATUS = { pending: ['Oczekuje', 'st-next'], accepted: ['✓ Przyjęte', 'st-done'], rejected: ['Odrzucone', 'st-over'] };
const FILTERS = [['pending', 'Oczekujące'], ['accepted', 'Przyjęte'], ['rejected', 'Odrzucone'], ['all', 'Wszystkie']];

export function SignupsAdmin({ postId }) {
  const [filter, setFilter] = useState(null);
  const data = useAsync(async () => {
    const [post] = await db.list('posts', { eq: { id: postId } });
    if (!post) throw new Error('Nie ma takiego ogłoszenia');
    const [list, season] = await Promise.all([
      post.form_kind === 'internal' ? db.rpc('signup_list', { p_post: postId }) : [],
      post.form_season_id ? db.list('seasons', { eq: { id: post.form_season_id } }).then((x) => x[0] || null) : null,
    ]);
    return { post, list: list || [], season };
  }, [postId]);

  const back = html`<a class="btn btn-sm" href="#/admin/ogloszenia">← Ogłoszenia</a>`;
  if (data.loading && !data.data) return html`<${Loader} />`;
  if (data.error) {
    return html`${back}<div class="hint warn">Zgłoszenia wymagają aktualizacji bazy: uruchom w Supabase → SQL Editor plik <b>supabase/migrations/2026-11-01_zgloszenia.sql</b> (niczego nie usuwa).</div><${ErrorBox} error=${data.error} />`;
  }
  const { post, list, season } = data.data;
  const open = formOpen(post);
  const fields = post.form_fields || [];
  const count = (st) => list.filter((x) => x.status === st).length;
  const active = filter || (count('pending') ? 'pending' : 'all');
  const shown = active === 'all' ? list : list.filter((x) => x.status === active);

  const decide = async (x, status) => {
    if (status === 'accepted' && !confirm(`Przyjąć zgłoszenie: ${x.display_name}? Trafi do rezerwy: ${season ? seasonLabel(season) : '?'}.`)) return;
    if (status !== 'accepted' && x.status === 'accepted' && !confirm(`Cofnąć przyjęcie ${x.display_name}? Zniknie z rezerwy sezonu (o ile nie ma jeszcze miejsca w zespole ani wyników).`)) return;
    const msg = { accepted: `${x.display_name}: przyjęte — dodano do rezerwy`, rejected: `${x.display_name}: odrzucone`, pending: 'Decyzja cofnięta' }[status];
    if (await attempt(() => db.rpc('signup_decide', { p_signup: x.id, p_status: status }), msg)) data.reload();
  };

  const csv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Discord', 'Kierowca', 'Status', 'Wysłane', ...fields.map((f) => f.label)];
    const rows = list.map((x) => [x.display_name, x.driver_nick || '', STATUS[x.status][0], formatDate(x.created_at), ...fields.map((f) => answerText(f, x.answers?.[f.id]).replace('—', ''))]);
    const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `zgloszenia-${post.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return html`
    <div class="season-bar">
      <div class="season-bar-title"><span class="eyebrow">Zgłoszenia</span><b class="season-switch-static">${post.title}</b></div>
      <div class="head-controls">${back}${list.length ? html`<button class="btn btn-sm" onClick=${csv}>⬇ Pobierz CSV</button>` : null}</div>
    </div>
    <div class="signup-summary">
      <span class=${`tile-state ${open ? 'st-live' : 'st-done'}`}>${open ? 'Zapisy trwają' : 'Zapisy zakończone'}</span>
      ${post.form_until ? html`<span class="muted">do ${formatDate(post.form_until)}${open ? ` · ${timeLeft(post.form_until)}` : ''}</span>` : null}
      <span>Sezon: <b>${season ? seasonLabel(season) : 'nie wybrano'}</b></span>
      ${season ? html`<a href=${`#/admin/${season.series}/${season.id}/start/sklady`}>Skład sezonu →</a>` : null}
    </div>
    ${post.form_kind === 'internal' && post.form_until ? html`<p class="muted small">Zgłoszenia zostaną usunięte automatycznie ${formatDate(signupsPurgeAt(post))} — ${SIGNUP_KEEP_DAYS} dni po zakończeniu zapisów (polityka prywatności). Przyjęci kierowcy zostają w składzie sezonu.</p>` : null}
    ${post.form_kind !== 'internal' ? html`<p class="hint">To ogłoszenie ${post.form_kind === 'external' ? 'ma link do zewnętrznego formularza — zgłoszenia są w tamtym serwisie' : 'nie ma formularza'}.</p>` : html`
      ${!season ? html`<p class="hint warn">Formularz nie ma wybranego sezonu — ustaw go w edycji ogłoszenia, żeby móc przyjmować zgłoszenia.</p>` : null}
      <div class="seg signup-filters">
        ${FILTERS.map(([id, label]) => html`<button class=${`btn btn-sm ${active === id ? 'btn-accent' : ''}`} onClick=${() => setFilter(id)}>
          ${label} (${id === 'all' ? list.length : count(id)})</button>`)}
      </div>
      ${!shown.length ? html`<p class="muted">${list.length ? 'Brak zgłoszeń w tym widoku.' : 'Nikt się jeszcze nie zgłosił.'}</p>` : null}
      <div class="signup-list">
        ${shown.map((x) => html`<article class=${`signup-card signup-${x.status}`} key=${x.id}>
          <header class="signup-card-head">
            ${x.avatar_url ? html`<img class="signup-avatar" src=${x.avatar_url} alt="" />` : html`<span class="signup-avatar">${(x.display_name || '?')[0]}</span>`}
            <div class="signup-who">
              <b>${x.display_name}</b>
              <span class="muted small">${x.driver_nick
                ? html`Profil kierowcy: <a href=${`#/kierowca/${x.driver_id}`}>${x.driver_nick}</a>`
                : x.claim_nick ? `Czeka na powiązanie z kierowcą ${x.claim_nick} (panel Użytkownicy)` : 'Bez profilu kierowcy — powstanie przy przyjęciu'}
                ${x.in_season ? html` · <b>${x.team_id ? 'już w zespole tego sezonu' : 'w rezerwie sezonu'}</b>` : null}</span>
            </div>
            <span class=${`tile-state ${STATUS[x.status][1]}`}>${STATUS[x.status][0]}</span>
          </header>
          ${fields.length ? html`<dl class="signup-answers">
            ${fields.map((f) => html`<dt>${f.label}</dt><dd>${answerText(f, x.answers?.[f.id])}</dd>`)}
          </dl>` : null}
          <footer class="signup-card-foot">
            <span class="muted small">Wysłane ${formatDate(x.created_at)}${x.updated_at && x.updated_at !== x.created_at ? ` · poprawione ${formatDate(x.updated_at)}` : ''}${x.decided_at ? ` · decyzja: ${x.decided_by || '?'}, ${formatDate(x.decided_at)}` : ''}</span>
            <span class="spacer"></span>
            ${x.status !== 'accepted' ? html`<button class="btn btn-sm btn-accent" disabled=${!season} onClick=${() => decide(x, 'accepted')}>✓ Przyjmij do rezerwy</button>` : null}
            ${x.status !== 'rejected' ? html`<button class="btn btn-sm btn-danger" onClick=${() => decide(x, 'rejected')}>Odrzuć</button>` : null}
            ${x.status !== 'pending' ? html`<button class="btn btn-sm" onClick=${() => decide(x, 'pending')}>Cofnij decyzję</button>` : null}
          </footer>
        </article>`)}
      </div>
    `}
  `;
}
