import { useEffect, useRef } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, cached, Loader, ErrorBox, Empty, Countdown, Flag, formatDate, sessionLabel, STREAMS, StreamLinks, LiveBadge } from '../ui.js';
import { registerClasses, carClass, isSprint, sessionOrder } from '../scoring.js';
import { SectionHead } from './section.js';
import { LeagueSection } from './league.js';

// Inne: wydarzenia spoza lig F1 i LMU.
//  - Wydarzenia: serie kilku wyścigów i pojedyncze wydarzenia (własne klasy aut, składy) — silnik ligi,
//  - Open lobby: luźne, regularne jazdy z transmisją (bez wyników).
// Adresy: #/inne (lista wydarzeń), #/inne/e/<wydarzenie>/<podstrona>, #/inne/lobby[/<lobby>]

const TOPNAV = [['wydarzenia', 'Serie i wydarzenia', '#/inne'], ['lobby', 'Open lobby', '#/inne/lobby']];

export function OtherTopNav({ active }) {
  return html`<nav class="wrap topnav">
    ${TOPNAV.map(([id, label, href]) => html`<a href=${href} class=${active === id ? 'active' : ''}>${label}</a>`)}
  </nav>`;
}

// ---------- wydarzenia i serie ----------

/** Wydarzenia „Inne” z kalendarzem (jedno zapytanie o wyścigi wszystkich wydarzeń). Bez aktualizacji bazy — pusta lista. */
export const loadEvents = () => cached('inne-events', async () => {
  const seasons = await db.list('seasons', { eq: { series: 'inne' }, order: ['created_at', false] }).catch(() => []);
  if (!seasons.length) return [];
  const ids = seasons.map((x) => x.id);
  const [races, teams, tracks] = await Promise.all([
    db.list('races', { in: { season_id: ids } }),
    db.list('teams', { in: { season_id: ids } }),
    db.list('tracks'),
  ]);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  return seasons.map((season) => {
    registerClasses(season.class_defs);
    const sessions = races.filter((r) => r.season_id === season.id).sort(sessionOrder);
    const main = sessions.filter((r) => !isSprint(r));
    const next = sessions.find((r) => r.status !== 'completed') || null;
    const ready = main.length > 0 && teams.some((t) => t.season_id === season.id);
    const state = !ready ? 'wip' : !next ? 'finished' : sessions.some((r) => r.status === 'completed') ? 'running' : 'upcoming';
    return { season, sessions, main, next, nextTrack: next ? trackById.get(next.track_id) : null, last: main.at(-1) || null, state };
  });
});

/** Wydarzenia z kalendarzem, które jeszcze trwają (strona główna: nadchodzące wydarzenia i karty serii). */
export const activeEvents = (events) => events.filter((e) => e.state === 'upcoming' || e.state === 'running');

const EVENT_STATE = { wip: 'Szczegóły wkrótce', upcoming: 'Nadchodzące', running: 'W trakcie', finished: 'Zakończone' };

export const eventFormatLabel = (season, rounds) => (season.event_format === 'single'
  ? 'Pojedyncze wydarzenie'
  : `Seria${rounds ? ` · ${rounds} ${rounds === 1 ? 'runda' : rounds < 5 ? 'rundy' : 'rund'}` : ''}`);

export function EventClasses({ season }) {
  const list = season.class_defs || [];
  if (!list.length) return null;
  return html`<span class="up-classes">${list.map((c) => html`<span class="class-badge" style=${{ '--cls': carClass(c.id)?.color }}>${c.label || c.id}</span>`)}</span>`;
}

function EventsList({ events }) {
  const order = { running: 0, upcoming: 1, wip: 2, finished: 3 };
  const at = (e) => new Date(e.next?.race_date || e.last?.race_date || 0).getTime();
  const list = [...events].sort((a, c) => order[a.state] - order[c.state] || (a.state === 'finished' ? at(c) - at(a) : at(a) - at(c)));
  const live = list.filter((e) => e.state !== 'finished');
  const done = list.filter((e) => e.state === 'finished');
  return html`
    <div class="page-head"><h2>Serie i wydarzenia</h2></div>
    <p class="muted">Serie kilku wyścigów i pojedyncze wydarzenia poza ligami F1 i Le Mans Ultimate.</p>
    ${live.length ? html`<div class="event-grid">${live.map((e) => html`<${EventCard} key=${e.season.id} e=${e} />`)}</div>`
      : html`<${Empty}>Brak zaplanowanych wydarzeń. Zajrzyj do zakładki <a href="#/inne/lobby">Open lobby</a>.<//>`}
    ${done.length ? html`<h3>Zakończone</h3><div class="event-grid">${done.map((e) => html`<${EventCard} key=${e.season.id} e=${e} />`)}</div>` : null}
  `;
}

function EventCard({ e }) {
  const { season, next, nextTrack, main, state } = e;
  return html`<a class=${`event-card event-${state}`} href=${`#/inne/e/${season.id}`}>
    <div class="event-card-top">
      <span class="event-format">${eventFormatLabel(season, main.length)}</span>
      <span class=${`tile-state ${state === 'finished' ? 'st-done' : state === 'running' ? 'st-live' : 'st-next'}`}>${EVENT_STATE[state]}</span>
    </div>
    <h3>${season.name}</h3>
    <${EventClasses} season=${season} />
    ${season.description ? html`<p class="event-desc">${season.description}</p>` : null}
    ${next && state !== 'wip' ? html`<div class="event-next">
      <span class="field-label">${season.event_format === 'single' ? 'Start' : `Następnie: ${sessionLabel(next)}`}</span>
      <span><${Flag} code=${nextTrack?.country_code} size=${18} /> ${nextTrack?.name ?? 'Tor do ustalenia'} · ${next.race_date ? formatDate(next.race_date) : 'termin do ustalenia'}</span>
    </div>` : null}
    <span class="more">${state === 'finished' ? 'Wyniki' : 'Szczegóły'} →</span>
  </a>`;
}

function EventPage({ id, parts }) {
  const events = useAsync(loadEvents, []);
  if (events.loading) return html`<div class="wrap page"><${Loader} /></div>`;
  if (events.error) return html`<div class="wrap page"><${ErrorBox} error=${events.error} /></div>`;
  const e = events.data.find((x) => x.season.id === id);
  if (!e) return html`<div class="wrap page"><${Empty}>Nie znaleziono wydarzenia. <a href="#/inne">Wszystkie wydarzenia →</a><//></div>`;
  return html`<${LeagueSection} series="inne" fixedSeason=${e.season} parts=${parts} top=${html`<${OtherTopNav} active="wydarzenia" />`} />`;
}

// ---------- open lobby ----------

// tabela dochodzi w aktualizacji bazy — bez niej strona działa dalej (brak lobby)
export const loadLobbies = () => cached('lobbies', () => db.list('lobbies', { order: ['start_at'] }).catch(() => []));

/** 'scheduled' | 'live' | 'ended' — automatycznie wg godziny startu i czasu trwania, chyba że moderator ustawił ręcznie. */
export function lobbyState(l, now = Date.now()) {
  if (l.status === 'live' || l.status === 'ended') return l.status;
  if (!l.start_at) return 'scheduled';
  const start = new Date(l.start_at).getTime();
  if (now < start) return 'scheduled';
  return now < start + (l.duration_minutes || 120) * 60000 ? 'live' : 'ended';
}

// przyciski transmisji są wspólne z ligami (ui.js)
export { STREAMS, StreamLinks, LiveBadge };

export const lobbyMeta = (l) => [l.game, l.cars].filter(Boolean).join(' · ');

export function OtherSection({ parts }) {
  const [sub, ...rest] = parts;
  if (sub === 'e' && rest[0]) return html`<${EventPage} key=${rest[0]} id=${rest[0]} parts=${rest.slice(1)} />`;
  return sub === 'lobby' ? html`<${LobbyPage} focusId=${rest[0]} />` : html`<${EventsPage} />`;
}

function EventsPage() {
  const data = useAsync(loadEvents, []);
  let body;
  if (data.loading) body = html`<${Loader} />`;
  else if (data.error) body = html`<${ErrorBox} error=${data.error} />`;
  else body = html`<${EventsList} events=${data.data} />`;
  return html`<div class="section-inne">
    <${SectionHead} series="inne" top=${html`<${OtherTopNav} active="wydarzenia" />`} />
    <div class="wrap page">${body}</div>
  </div>`;
}

function LobbyPage({ focusId }) {
  const data = useAsync(loadLobbies, []);
  let body;
  if (data.loading) body = html`<${Loader} />`;
  else if (data.error) body = html`<${ErrorBox} error=${data.error} />`;
  else body = html`<${LobbyList} lobbies=${data.data} focusId=${focusId} />`;
  return html`<div class="section-inne">
    <${SectionHead} series="inne" top=${html`<${OtherTopNav} active="lobby" />`} />
    <div class="wrap page">${body}</div>
  </div>`;
}

function LobbyList({ lobbies, focusId }) {
  const now = Date.now();
  const of = (st) => lobbies.filter((l) => lobbyState(l, now) === st);
  const live = of('live');
  const upcoming = of('scheduled');
  const ended = of('ended').reverse().slice(0, 10);
  return html`
    <div class="page-head"><h2>Open lobby</h2></div>
    <p class="muted">Otwarte jazdy dla wszystkich chętnych — bez zapisów i klasyfikacji. Dołącz przez Discord albo oglądaj transmisję.</p>
    ${live.length ? html`<div class="lobby-list">${live.map((l) => html`<${LobbyCard} key=${l.id} lobby=${l} state="live" focused=${l.id === focusId} />`)}</div>` : null}
    <h3>Nadchodzące</h3>
    ${upcoming.length
      ? html`<div class="lobby-list">${upcoming.map((l) => html`<${LobbyCard} key=${l.id} lobby=${l} state="scheduled" focused=${l.id === focusId} />`)}</div>`
      : html`<${Empty}>Brak zaplanowanych lobby.<//>`}
    ${ended.length ? html`<h3>Ostatnie</h3>
      <div class="lobby-list">${ended.map((l) => html`<${LobbyCard} key=${l.id} lobby=${l} state="ended" focused=${l.id === focusId} />`)}</div>` : null}
  `;
}

function LobbyCard({ lobby, state, focused }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start' });
  }, [focused]);
  return html`<article ref=${ref} id=${`lobby-${lobby.id}`} class=${`lobby-card lobby-${state} ${focused ? 'focused' : ''}`}>
    <div class="lobby-main">
      <div class="eyebrow">${state === 'live' ? html`<${LiveBadge} />` : state === 'ended' ? 'Zakończone' : 'Open lobby'}</div>
      <h3>${lobby.title}</h3>
      <div class="lobby-meta">
        <span>📅 ${lobby.start_at ? formatDate(lobby.start_at) : 'Termin do ustalenia'}</span>
        ${lobbyMeta(lobby) ? html`<span>🏎️ ${lobbyMeta(lobby)}</span>` : null}
      </div>
      ${lobby.description ? html`<p class="lobby-desc">${lobby.description}</p>` : null}
      <${StreamLinks} links=${lobby} />
    </div>
    ${state === 'scheduled' && lobby.start_at ? html`<div class="lobby-side"><${Countdown} to=${lobby.start_at} /></div>` : null}
  </article>`;
}
