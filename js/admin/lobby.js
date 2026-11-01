import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, attempt, formatDate } from '../ui.js';
import { toLocalInput, fromLocalInput, DateTimeInput, DurationInput } from './common.js';
import { lobbyState, lobbyMeta, STREAMS } from '../pages/other.js';

// Eventy → Open lobby: luźne, regularne jazdy z transmisją. Bez zapisów, składów i wyników.
// Status liczy się sam (wg startu i czasu trwania); moderator może go ustawić ręcznie.

const STATE_LABEL = { scheduled: 'Zaplanowane', live: '🔴 Trwa teraz', ended: '✓ Zakończone' };
const STATE_CLASS = { scheduled: 'st-next', live: 'st-live', ended: 'st-done' };

export function LobbyAdmin() {
  const [open, setOpen] = useState(null);
  const data = useAsync(() => db.list('lobbies', { order: ['start_at'] }), []);
  if (data.loading && !data.data) return html`<${Loader} />`;
  if (data.error) {
    return html`<div class="hint warn">Open lobby wymaga aktualizacji bazy: uruchom w Supabase → SQL Editor plik
      <b>supabase/migrations/2026-10-30_inne_lobby_ogloszenia.sql</b> (niczego nie usuwa).</div><${ErrorBox} error=${data.error} />`;
  }
  const lobbies = data.data;
  const now = Date.now();
  const active = lobbies.filter((l) => lobbyState(l, now) !== 'ended');
  const ended = lobbies.filter((l) => lobbyState(l, now) === 'ended').reverse();

  const add = async () => {
    const start = new Date(Date.now() + 86400000);
    start.setHours(20, 0, 0, 0);
    const l = await attempt(() => db.insert('lobbies', {
      title: 'Open lobby', game: '', cars: '', start_at: start.toISOString(), duration_minutes: 120, description: '', status: 'auto',
    }), 'Utworzono lobby — uzupełnij szczegóły i linki do transmisji');
    if (l) {
      setOpen(l.id);
      data.reload();
    }
  };

  const row = (l) => {
    const st = lobbyState(l, now);
    const isOpen = open === l.id;
    return html`<div class=${`end-admin ${isOpen ? 'open' : ''}`} key=${l.id}>
      <button class="end-admin-head" onClick=${() => setOpen(isOpen ? null : l.id)} aria-expanded=${isOpen}>
        <span class="end-admin-title"><b>${l.title}</b>
          <span class="muted">${l.start_at ? formatDate(l.start_at) : 'termin do ustalenia'}${lobbyMeta(l) ? ` · ${lobbyMeta(l)}` : ''}</span>
        </span>
        <span class="end-admin-side">
          <span class=${`tile-state ${STATE_CLASS[st]}`}>${STATE_LABEL[st]}</span>
          <span class="chev">${isOpen ? '▲' : '▼'}</span>
        </span>
      </button>
      ${isOpen ? html`<${LobbyEditor} lobby=${l} state=${st} reload=${data.reload} onOpen=${setOpen} />` : null}
    </div>`;
  };

  return html`
    <div class="season-bar">
      <div class="season-bar-title"><span class="eyebrow">Eventy</span><b class="season-switch-static">Open lobby</b></div>
      <button class="btn btn-accent btn-sm" onClick=${add}>+ Nowe lobby</button>
    </div>
    <p class="muted">Otwarte jazdy bez zapisów i wyników. Lobby pojawia się w <a href="#/inne/lobby">Eventy → Open lobby</a> i w nadchodzących
      wydarzeniach na stronie głównej, a w trakcie — jako <b>„Trwa teraz”</b> z przyciskami do transmisji.</p>
    <h3>Nadchodzące i trwające (${active.length})</h3>
    <div class="end-admin-list">${active.map(row)}${!active.length ? html`<p class="muted">Brak zaplanowanych lobby.</p>` : null}</div>
    <h3>Zakończone (${ended.length})</h3>
    <div class="end-admin-list">${ended.map(row)}${!ended.length ? html`<p class="muted">Brak zakończonych lobby.</p>` : null}</div>
  `;
}

const isUrl = (v) => /^https?:\/\//i.test(v);

function LobbyEditor({ lobby, state, reload, onOpen }) {
  const patch = async (p) => (await attempt(() => db.update('lobbies', lobby.id, p))) && reload();
  const setLink = (key, v) => {
    const url = v.trim();
    if (url && !isUrl(url)) return alert('Podaj pełny adres, np. https://www.twitch.tv/…');
    return patch({ [key]: url || null });
  };
  // regularne lobby: kopia z tymi samymi ustawieniami i linkami tydzień później
  const repeat = async () => {
    const { id, created_at, ...rest } = lobby;
    const start = lobby.start_at ? new Date(new Date(lobby.start_at).getTime() + 7 * 86400000).toISOString() : null;
    const copy = await attempt(() => db.insert('lobbies', { ...rest, start_at: start, status: 'auto' }), `Zaplanowano kolejne lobby${start ? ` — ${formatDate(start)}` : ''}`);
    if (copy) {
      onOpen(copy.id);
      reload();
    }
  };
  const remove = async () => {
    if (!confirm(`Usunąć lobby „${lobby.title}”?`)) return;
    if (await attempt(() => db.remove('lobbies', lobby.id), 'Lobby usunięte')) {
      onOpen(null);
      reload();
    }
  };

  const mode = lobby.status || 'auto';
  return html`<div class="end-admin-body">
    <div class=${`end-status ${state === 'ended' ? 'is-finished' : state === 'live' ? 'is-live' : ''}`}>
      <div>
        <span class="field-label">Status na stronie</span>
        <div class="end-status-value">${STATE_LABEL[state]}</div>
        <div class="hint">${mode === 'auto' ? 'Automatycznie: „Trwa teraz” od startu przez podany czas trwania.' : 'Ustawione ręcznie.'}</div>
      </div>
      <div class="seg">
        ${[['auto', 'Automatycznie'], ['live', 'Trwa teraz'], ['ended', 'Zakończone']].map(([id, label]) => html`<button class=${`btn btn-sm ${mode === id ? 'btn-accent' : ''}`} onClick=${() => mode !== id && patch({ status: id })}>${label}</button>`)}
      </div>
    </div>
    <div class="form-grid">
      <label class="field span2"><span>Nazwa</span><input value=${lobby.title} onChange=${(e) => patch({ title: e.target.value.trim() || lobby.title })} placeholder="np. Czwartkowe open lobby GT3" /></label>
      <label class="field"><span>Gra</span><input value=${lobby.game || ''} onChange=${(e) => patch({ game: e.target.value.trim() })} placeholder="np. Le Mans Ultimate, F1 25" /></label>
      <label class="field"><span>Auta</span><input value=${lobby.cars || ''} onChange=${(e) => patch({ cars: e.target.value.trim() })} placeholder="np. GT3, dowolne auto" /></label>
      <label class="field"><span>Start</span><${DateTimeInput} value=${toLocalInput(lobby.start_at)} onChange=${(v) => patch({ start_at: fromLocalInput(v) })} /></label>
      <label class="field"><span>Czas trwania</span><${DurationInput} value=${lobby.duration_minutes} placeholder=${120} minuteStep=${15} onChange=${(v) => patch({ duration_minutes: v })} /></label>
      <label class="field span2"><span>Opis (opcjonalnie)</span><textarea rows="3" value=${lobby.description || ''} onChange=${(e) => patch({ description: e.target.value })} placeholder="np. tor, zasady, jak dołączyć"></textarea></label>
      ${STREAMS.filter(([key]) => key !== 'other_url').map(([key, label]) => html`<label class="field"><span>${key === 'discord_url' ? 'Discord (link do kanału / zaproszenie)' : `Transmisja ${label}`}</span>
        <input value=${lobby[key] || ''} placeholder="https://…" onChange=${(e) => setLink(key, e.target.value)} /></label>`)}
    </div>
    <div class="form-actions">
      <button class="btn" onClick=${repeat} title="Kopia z tymi samymi ustawieniami i linkami">↻ Zaplanuj kolejne (+7 dni)</button>
      <span class="spacer"></span>
      <button class="btn btn-danger btn-sm" onClick=${remove}>Usuń lobby</button>
    </div>
  </div>`;
}
