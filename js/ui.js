// Wspólne komponenty i hooki.
import { html, useState, useEffect, useCallback } from '../vendor/preact-htm.js';
import { db } from './db.js';
import { bundleLineup } from './lineup.js';

export { html };

// ---------- dane ----------

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null, key: null });
  const [tick, setTick] = useState(0);
  // klucz zależności: dopóki wynik nie dotyczy bieżących deps, raportujemy "ładowanie"
  const key = JSON.stringify(deps);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ loading: false, data, error: null, key }),
      (error) => alive && setState({ loading: false, data: null, error, key }),
    );
    return () => { alive = false; };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const stale = state.key !== key;
  return { loading: state.loading || stale, data: stale ? null : state.data, error: stale ? null : state.error, reload };
}

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));

// ---------- pamięć podręczna danych ----------
// Dane z bazy trzymamy w pamięci przez kilka minut, żeby przechodzenie między stronami było natychmiastowe.
// Każdy zapis (panel admina) czyści pamięć — patrz zdarzenie 'ssp-db-write' w db.js.

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();
window.addEventListener('ssp-db-write', () => cache.clear());

export function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.promise;
  const promise = fn().catch((e) => {
    cache.delete(key); // błędu nie zapamiętujemy
    throw e;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

const sortBy = (rows, key) => [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0));

function makeBundle(raw) {
  const teams = sortBy(raw.teams || [], 'name');
  const tracks = sortBy(raw.tracks || [], 'name');
  const drivers = sortBy(raw.drivers || [], 'nick');
  return {
    season: raw.seasons?.[0] ?? null,
    teams,
    entries: raw.entries || [],
    races: sortBy(raw.races || [], 'round'),
    tracks,
    drivers,
    results: raw.results || [],
    penalties: sortBy(raw.penalties || [], 'created_at'),
    rosterChanges: sortBy(raw.roster_changes || [], 'from_round'),
    teamById: byId(teams), driverById: byId(drivers), trackById: byId(tracks),
  };
}

/** Pobranie sezonu po staremu (~9 zapytań w 3 falach) — gdy w bazie nie ma jeszcze funkcji season_bundle. */
async function fetchBundleTables(seasonId) {
  const [seasons, teams, entries, races, tracks, drivers, rosterChanges] = await Promise.all([
    db.list('seasons', { eq: { id: seasonId } }),
    db.list('teams', { eq: { season_id: seasonId } }),
    db.list('entries', { eq: { season_id: seasonId } }),
    db.list('races', { eq: { season_id: seasonId } }),
    db.list('tracks'),
    db.list('drivers'),
    db.list('roster_changes', { eq: { season_id: seasonId } }),
  ]);
  const raceIds = races.map((r) => r.id);
  const [results, penalties] = await Promise.all([
    db.list('results', { in: { race_id: raceIds } }),
    db.list('penalties', { in: { race_id: raceIds } }),
  ]);
  return { seasons, teams, entries, races, tracks, drivers, results, penalties, roster_changes: rosterChanges };
}

/** Wszystko, czego potrzeba do wyświetlenia sezonu — jednym zapytaniem (funkcja season_bundle w bazie). */
export function loadSeasonBundle(seasonId) {
  return cached(`bundle:${seasonId}`, async () => {
    const raw = (await db.seasonBundle?.(seasonId, null)) || (await fetchBundleTables(seasonId));
    return makeBundle(raw);
  });
}

/** Bieżący sezon danej serii (np. na stronie głównej) — jednym zapytaniem. */
export function loadCurrentBundle(series) {
  return cached(`current:${series}`, async () => {
    const raw = await db.seasonBundle?.(null, series);
    if (raw) return raw.seasons?.length ? makeBundle(raw) : null;
    const season = pickSeason(await listSeasons(series), series);
    return season ? loadSeasonBundle(season.id) : null;
  });
}

export function listSeasons(series) {
  return cached(`seasons:${series}`, () => db.list('seasons', { eq: { series }, order: ['created_at', false] }));
}

const SEASON_KEY = (series) => `ssp_season_${series}`;

export function pickSeason(seasons, series) {
  let saved = null;
  try { saved = localStorage.getItem(SEASON_KEY(series)); } catch { /* brak storage */ }
  return seasons.find((s) => s.id === saved) || seasons.find((s) => s.is_current) || seasons[0] || null;
}

export function rememberSeason(series, id) {
  try { localStorage.setItem(SEASON_KEY(series), id); } catch { /* brak storage */ }
}

/** Adres sekcji ligi danej serii: F1 -> #/f1, liga LMU -> #/lmu/liga. */
export const seriesBase = (series) => (series === 'lmu' ? '#/lmu/liga' : '#/f1');

/**
 * Jednostka sezonu: w F1 kierowcy jadą w zespołach, w lidze LMU — samochodami (marka/model).
 * W bazie to ta sama tabela (teams); różni się tylko nazewnictwo i adresy.
 */
const UNITS = {
  f1: { one: 'Zespół', many: 'Zespoły', gen: 'zespołów', path: 'zespol', listPath: 'zespoly', lineup: 'Składy startowe', profile: 'Profil zespołu' },
  lmu: { one: 'Samochód', many: 'Samochody', gen: 'samochodów', path: 'samochod', listPath: 'samochody', lineup: 'Przypisanie aut', profile: 'Szczegóły auta' },
};
export const unit = (series) => UNITS[series] || UNITS.f1;
export const teamHref = (series, id) => `${seriesBase(series)}/${unit(series).path}/${id}`;
export const teamListHref = (series) => `${seriesBase(series)}/${unit(series).listPath}`;

// ---------- formatowanie ----------

export function formatDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortDate(iso) {
  if (!iso) return { day: '—', month: '' };
  const d = new Date(iso);
  return { day: d.getDate(), month: d.toLocaleString('pl-PL', { month: 'short' }).replace('.', '') };
}

// ---------- drobne komponenty ----------

export function Flag({ code, size = 20 }) {
  if (!code) return null;
  return html`<img class="flag" src=${`https://flagcdn.com/w40/${code.toLowerCase()}.png`} alt=${code} width=${size} height=${Math.round(size * 0.75)} loading="lazy" />`;
}

/** Nazwa zespołu taka, jaka obowiązywała w sezonie tego wyniku (logo + kolor). */
export function TeamTag({ team, link = true, base }) {
  if (!team) return html`<span class="muted">—</span>`;
  const inner = html`<i style=${{ background: team.color || '#888' }}></i>${team.logo_url ? html`<${TeamLogo} team=${team} size=${20} />` : null}<span>${team.name}</span>`;
  return link
    ? html`<a class="team-tag" href=${teamHref(base === seriesBase('lmu') ? 'lmu' : 'f1', team.id)}>${inner}</a>`
    : html`<span class="team-tag">${inner}</span>`;
}

/** Logo na jasnym kafelku: ciemne loga (np. Cadillac, Aston Martin) są czytelne na ciemnej stronie. */
export function TeamLogo({ team, size = 48 }) {
  if (!team?.logo_url) {
    return html`<span class="team-logo team-logo-empty" style=${{ width: `${size}px`, height: `${size}px`, '--team': team?.color || '#888' }}></span>`;
  }
  const pad = Math.max(2, Math.round(size * 0.12));
  return html`<span class="team-logo" style=${{ width: `${size}px`, height: `${size}px`, padding: `${pad}px` }}><img src=${team.logo_url} alt="" loading="lazy" /></span>`;
}

/** Grafika bolidu; bez grafiki rysuje pas w barwach zespołu. */
export function TeamCar({ team, cls = '' }) {
  if (team?.car_url) return html`<img class=${`team-car ${cls}`} src=${team.car_url} alt=${`Bolid ${team.name}`} loading="lazy" />`;
  return html`<div class=${`team-car placeholder ${cls}`} style=${{ '--team': team?.color || '#888' }}><span>Brak zdjęcia auta</span></div>`;
}

export function DriverLink({ driver }) {
  if (!driver) return html`<span class="muted">?</span>`;
  return html`<a class="driver-link" href=${`#/kierowca/${driver.id}`}>
    <${Flag} code=${driver.country_code} size=${18} />
    ${driver.number != null && driver.number !== '' ? html`<span class="num">${driver.number}</span>` : null}
    <span>${driver.nick}</span>
  </a>`;
}

export function PosBadge({ pos, status }) {
  if (!pos) return html`<span class="pos pos-out">${status}</span>`;
  return html`<span class=${`pos ${pos <= 3 ? `pos-${pos}` : ''}`}>${pos}</span>`;
}

export function Loader() {
  return html`<div class="loader"><span></span>Ładowanie…</div>`;
}

export function ErrorBox({ error }) {
  return html`<div class="alert alert-error">Błąd: ${error?.message || String(error)}</div>`;
}

export function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}

export function Tabs({ tabs, value, onChange }) {
  return html`<div class="tabs" role="tablist">
    ${tabs.map((t) => html`<button role="tab" aria-selected=${value === t.id} class=${value === t.id ? 'active' : ''} onClick=${() => onChange(t.id)}>${t.label}</button>`)}
  </div>`;
}

export function Countdown({ to }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, new Date(to).getTime() - now);
  const parts = [
    [Math.floor(diff / 86400000), 'dni'],
    [Math.floor((diff % 86400000) / 3600000), 'godz'],
    [Math.floor((diff % 3600000) / 60000), 'min'],
    [Math.floor((diff % 60000) / 1000), 'sek'],
  ];
  return html`<div class="countdown">
    ${parts.map(([v, l]) => html`<div><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`)}
  </div>`;
}

// ---------- powiadomienia ----------

const listeners = new Set();
export function toast(msg, kind = 'ok') {
  listeners.forEach((fn) => fn({ msg, kind, id: Math.random() }));
}

export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 3500);
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return html`<div class="toasts">${items.map((t) => html`<div class=${`toast toast-${t.kind}`}>${t.msg}</div>`)}</div>`;
}

/** Opakowanie akcji zapisu: komunikat sukcesu / błędu. */
export async function attempt(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r ?? true;
  } catch (e) {
    toast(e.message || String(e), 'error');
    return false;
  }
}

// ---------- skład: kierowca etatowy / rezerwa ----------

/**
 * Aktualny status kierowcy w sezonie (skład startowy + zmiany), nie na podstawie wyników.
 * Wyniki zawsze zostają przy zespole, dla którego zostały zdobyte.
 */
export function driverSeat(b, driverId) {
  const seat = bundleLineup(b).get(driverId); // skład po wszystkich zmianach w sezonie
  if (seat?.team_id) return { reserve: false, team: b.teamById.get(seat.team_id) };
  return { reserve: true, team: null };
}

/** Rola kierowcy względem zespołu: obecny skład, były kierowca (po zmianie w składzie) albo zastępstwo. */
export function roleInTeam(b, driverId, teamId) {
  const seat = driverSeat(b, driverId);
  if (!seat.reserve && seat.team?.id === teamId) return 'current';
  const change = b.rosterChanges?.find((c) => c.team_id === teamId && c.driver_out_id === driverId);
  if (change) return 'former';
  if (!seat.reserve) return 'moved';
  return 'sub';
}

export const ROLE_LABEL = { former: 'Były kierowca', sub: 'Zastępstwo', moved: 'Przeszedł do innego zespołu' };

/** Komórka "Zespół" w klasyfikacji: obecny zespół albo Rezerwa + zespoły, dla których jechał. */
export function SeatCell({ b, driverId, teamIds = [] }) {
  const seat = driverSeat(b, driverId);
  if (!seat.reserve) return html`<${TeamTag} team=${seat.team} />`;
  const drove = teamIds.map((id) => b.teamById.get(id)).filter(Boolean);
  return html`<span class="seat-reserve">
    <span class="badge badge-reserve">Rezerwa</span>
    ${drove.length ? html`<span class="seat-drove" title="Punkty zdobywał dla tych zespołów">${drove.map((t) => html`<a href=${teamHref(b.season.series, t.id)} class="seat-team"><i style=${{ background: t.color || '#888' }}></i>${t.name}</a>`)}</span>` : null}
  </span>`;
}

// ---------- tory: nitka toru i film z przejazdu ----------

/** ID filmu z linku YouTube (watch?v=, youtu.be/, /shorts/, /embed/, /live/) albo null. */
export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).trim().match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Film ładowany dopiero po kliknięciu — strona nie pobiera odtwarzacza YouTube bez potrzeby. */
export function VideoEmbed({ url, title }) {
  const id = youtubeId(url);
  const [play, setPlay] = useState(false);
  if (!id) return null;
  if (play) {
    return html`<div class="video-frame"><iframe src=${`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
      title=${title || 'Przejazd toru'} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  }
  return html`<button class="video-frame video-thumb" onClick=${() => setPlay(true)} aria-label=${`Odtwórz: ${title || 'przejazd toru'}`}>
    <img src=${`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
    <span class="video-play">▶</span>
    <span class="video-caption">${title || 'Przejazd toru'}</span>
  </button>`;
}

/** Nitka toru + film z przejazdu (jeśli są). */
export function TrackMedia({ track }) {
  if (!track?.layout_url && !youtubeId(track?.video_url)) return null;
  return html`<div class="track-media">
    ${track.layout_url ? html`<figure class="track-layout"><img src=${track.layout_url} alt=${`Nitka toru ${track.name}`} loading="lazy" /></figure>` : null}
    ${youtubeId(track.video_url) ? html`<${VideoEmbed} url=${track.video_url} title=${`Przejazd: ${track.name}`} />` : null}
  </div>`;
}
