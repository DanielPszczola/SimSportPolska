import { useState, useEffect } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, cached, attempt, loadSeasonBundle, Flag, showModal, closeModal } from '../ui.js';
import { lineupAt, startingSeats } from '../lineup.js';

// Kierowca dnia: głosowanie w trakcie wyścigu — uruchamia i kończy je moderator (Zarządzanie → wyścig → „W trakcie
// wyścigu”); wtedy wszyscy widzą przycisk i kartę głosowania. Zamyka się też po zatwierdzeniu wyników albo po 12 h.
// Jeden głos na wyścig: zalogowany = konto, gość = identyfikator tej przeglądarki (localStorage); baza dodatkowo
// ogranicza liczbę głosów z jednej sieci. Po oddaniu głosu okno pokazuje bieżące wyniki zamiast ankiety.
// Zasady pilnuje baza (funkcje dotd_vote / dotd_poll / dotd_results).

const VOTER_KEY = 'ssp_voter';
let memoryToken = null; // tryb prywatny bez localStorage — identyfikator tylko na czas wizyty

/** Losowy identyfikator przeglądarki — po nim baza rozpoznaje, że ta przeglądarka już głosowała. */
function voterToken() {
  const fresh = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
  try {
    let t = localStorage.getItem(VOTER_KEY);
    if (!t) {
      t = fresh();
      localStorage.setItem(VOTER_KEY, t);
    }
    return t;
  } catch {
    memoryToken ||= fresh();
    return memoryToken;
  }
}

/** Wyniki sezonu: Map(race_id -> { winners: [driver_id], votes, total }). Bez aktualizacji bazy / w trybie demo — pusto. */
export const loadDotd = (seasonId) => cached(`dotd:${seasonId}`, async () => {
  const rows = await db.rpc('dotd_results', { p_season: seasonId }).catch(() => []);
  const map = new Map();
  for (const r of rows || []) {
    const cur = map.get(r.race_id);
    if (!cur || r.votes > cur.votes) map.set(r.race_id, { winners: [r.driver_id], votes: r.votes, total: r.total });
    else if (r.votes === cur.votes) cur.winners.push(r.driver_id);
  }
  return map;
});

/** Wynik w kafelku kalendarza: „⭐ Kierowca dnia: Nick · 42%” (label = np. „sprint”). */
export function DotdResult({ b, result, label }) {
  if (!result) return null;
  const pct = result.total ? Math.round((result.votes / result.total) * 100) : 0;
  return html`<div class="dotd-result" title=${`${result.votes} z ${result.total} głosów`}>
    <span class="dotd-star">⭐</span> <span class="muted">Kierowca dnia${label ? ` (${label})` : ''}:</span>
    <b>${result.winners.map((id) => b.driverById.get(id)?.nick ?? '?').join(' / ')}</b>
    <span class="muted">· ${pct}%</span>
  </div>`;
}

// ---------- trwające głosowania: uruchamia je moderator (Zarządzanie → wyścig → „W trakcie wyścigu”) ----------
// Jedna wspólna lista dla całej strony, odświeżana co 20 s (tylko gdy karta przeglądarki jest widoczna) — dzięki temu
// przycisk pojawia się u wszystkich bez odświeżania strony.
const LIVE_MS = 20000;
let live = [];
let liveTimer = null;
const liveSubs = new Set();
const notify = () => liveSubs.forEach((fn) => fn(live));

/** Pobiera listę trwających głosowań teraz (np. po uruchomieniu głosowania w panelu). */
export async function refreshDotdLive() {
  const rows = await db.rpc('dotd_live').catch(() => null); // bez aktualizacji bazy / w trybie demo — brak głosowań
  const next = Array.isArray(rows) ? rows : [];
  if (JSON.stringify(next) !== JSON.stringify(live)) { live = next; notify(); }
  return live;
}
function startLive() {
  if (liveTimer) return;
  refreshDotdLive();
  liveTimer = setInterval(() => document.visibilityState === 'visible' && refreshDotdLive(), LIVE_MS);
  document.addEventListener('visibilitychange', onVisible);
}
function stopLive() {
  clearInterval(liveTimer);
  liveTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
}
const onVisible = () => document.visibilityState === 'visible' && refreshDotdLive();

/** Trwające głosowania: [{ race_id, season_id, season, series, round, kind, track, country_code, started_at }]. */
export function useDotdLive() {
  const [list, setList] = useState(live);
  useEffect(() => {
    liveSubs.add(setList);
    startLive();
    return () => { liveSubs.delete(setList); if (!liveSubs.size) stopLive(); };
  }, []);
  return list;
}

// wyścigi, w których ta przeglądarka już głosowała (żeby karta pokazała „Zobacz wyniki” zamiast zachęty)
const VOTED_KEY = 'ssp_dotd_voted';
const votedSet = () => { try { return new Set(JSON.parse(localStorage.getItem(VOTED_KEY) || '[]')); } catch { return new Set(); } };
function markVoted(raceId) {
  try { localStorage.setItem(VOTED_KEY, JSON.stringify([...votedSet(), raceId].slice(-30))); } catch { /* tryb prywatny */ }
  window.dispatchEvent(new Event('ssp-dotd-voted'));
}
function useVoted() {
  const [set, setSet] = useState(votedSet);
  useEffect(() => {
    const fn = () => setSet(votedSet());
    window.addEventListener('ssp-dotd-voted', fn);
    return () => window.removeEventListener('ssp-dotd-voted', fn);
  }, []);
  return set;
}

const openVote = (b, race) => showModal(html`<${DotdModal} key=${race.id} b=${b} race=${race} onClose=${closeModal} />`);

/** Przycisk głosowania w kafelku wyścigu — widoczny, gdy moderator uruchomił głosowanie. */
export function DotdButton({ b, race }) {
  const list = useDotdLive();
  if (!b || !race || !list.some((x) => x.race_id === race.id)) return null;
  return html`<button type="button" class="btn btn-dotd" onClick=${() => openVote(b, race)}>⭐ Kierowca dnia</button>`;
}

/** Karta głosowania na każdej stronie (prawy dolny róg; na telefonie pasek na dole), gdy trwa głosowanie.
 *  Można ją zwinąć do gwiazdki — zwinięcie pamięta ta karta przeglądarki. */
export function DotdFloat() {
  const list = useDotdLive();
  const voted = useVoted();
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(sessionStorage.getItem('ssp_dotd_min') || '[]'); } catch { return []; } });
  const [busy, setBusy] = useState(false);
  useEffect(() => { // miejsce pod kartą na dole strony, żeby nie zasłaniała stopki
    document.body.classList.toggle('has-dotd-float', list.length > 0);
    return () => document.body.classList.remove('has-dotd-float');
  }, [list.length > 0]);
  if (!list.length) return null;
  const x = list[list.length - 1]; // najnowsze głosowanie (zwykle trwa jedno)
  const min = hidden.includes(x.race_id);
  const setMin = (v) => {
    const next = v ? [...hidden, x.race_id] : hidden.filter((id) => id !== x.race_id);
    setHidden(next);
    try { sessionStorage.setItem('ssp_dotd_min', JSON.stringify(next)); } catch { /* tryb prywatny */ }
  };
  const open = async () => {
    setBusy(true);
    const b = await loadSeasonBundle(x.season_id).catch(() => null);
    setBusy(false);
    const race = b?.sessions?.find((r) => r.id === x.race_id);
    if (b && race) openVote(b, race);
  };
  const done = voted.has(x.race_id);
  const where = `${x.track ?? 'Wyścig'}${x.kind === 'sprint' ? ' · Sprint' : ''}`;
  if (min) {
    return html`<button type="button" class="dotd-float-min" onClick=${() => setMin(false)} title="Głosowanie na kierowcę dnia trwa" aria-label="Pokaż głosowanie na kierowcę dnia">⭐</button>`;
  }
  return html`<aside class=${`dotd-float ${done ? 'is-done' : ''}`} aria-label="Głosowanie na kierowcę dnia">
    <button type="button" class="dotd-float-close" onClick=${() => setMin(true)} aria-label="Zwiń">✕</button>
    <div class="dotd-float-star" aria-hidden="true">⭐</div>
    <div class="dotd-float-text">
      <span class="dotd-float-eyebrow"><span class="live-dot"></span> ${done ? '✓ Zagłosowano' : 'Głosowanie trwa'}</span>
      <b>Kierowca dnia</b>
      <span class="dotd-float-sub"><${Flag} code=${x.country_code} size=${14} /> ${where} · ${x.season}</span>
    </div>
    <button type="button" class="btn dotd-float-cta" disabled=${busy} onClick=${open}>${busy ? 'Ładowanie…' : done ? 'Wyniki na żywo' : 'Głosuj teraz'}</button>
  </aside>`;
}

const REFRESH_MS = 15000;

function DotdModal({ b, race, onClose }) {
  const [poll, setPoll] = useState(null); // { open, my, results } z bazy
  const [error, setError] = useState(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReserves, setShowReserves] = useState(false);
  const [fresh, setFresh] = useState(race); // świeży wiersz wyścigu — skład startowy mógł się zmienić po wczytaniu strony
  useEffect(() => { db.list('races', { eq: { id: race.id } }).then((x) => x[0] && setFresh(x[0]), () => {}); }, [race.id]);
  const load = () => db.rpc('dotd_poll', { p_race: race.id, p_token: voterToken() }).then((x) => { setPoll(x); if (x?.my) markVoted(race.id); }, (e) => setError(e.message));

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  // stan głosowania; po oddaniu głosu wyniki odświeżają się same
  useEffect(() => {
    load();
    const t = setInterval(() => poll?.results && load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [race.id, !!poll?.results]);

  const vote = async (e) => {
    e.preventDefault();
    if (!pick) return;
    setBusy(true);
    const ok = await attempt(() => db.rpc('dotd_vote', { p_race: race.id, p_driver: pick, p_token: voterToken() }), 'Dziękujemy — głos zapisany');
    setBusy(false);
    if (ok) load();
  };

  const track = b.trackById.get(race.track_id);
  let body;
  if (error) body = html`<p class="hint warn">Głosowanie jest niedostępne: ${error}</p>`;
  else if (!poll) body = html`<p class="muted">Ładowanie…</p>`;
  else if (poll.results) body = html`<${DotdLiveResults} b=${b} poll=${poll} onClose=${onClose} />`;
  else if (!poll.open) body = html`<p class="muted">Głosowanie jest zamknięte.</p>`;
  else {
    // kandydaci: skład startowy wyścigu (ustawiony w panelu — tylko osoby, które faktycznie jadą);
    // bez niego skład rundy, a rezerwowi zwinięci — mogą jechać jako zastępstwo
    const custom = Array.isArray(fresh.start_lineup);
    const seats = [...startingSeats(b, fresh).values()];
    const groups = b.teams.map((t) => ({ team: t, ids: seats.filter((x) => x.team_id === t.id).map((x) => x.driver_id) })).filter((g) => g.ids.length);
    const reserves = seats.filter((x) => !x.team_id).map((x) => x.driver_id);
    if (reserves.length && (showReserves || custom)) groups.push({ team: null, ids: reserves, label: custom ? 'Zastępstwa' : 'Rezerwa / zastępstwa' });
    body = html`<form onSubmit=${vote}>
      <p class="muted">Kto jedzie dziś najlepiej? Masz jeden głos — po zagłosowaniu zobaczysz aktualne wyniki.</p>
      <div class="dotd-list">
        ${groups.map((g) => html`<fieldset class="dotd-group" style=${{ '--team': g.team?.color || '#888' }}>
          <legend>${g.team ? g.team.name : g.label}</legend>
          ${g.ids.map((id) => html`<label class=${`dotd-option ${pick === id ? 'active' : ''}`}>
            <input type="radio" name="dotd" value=${id} checked=${pick === id} onChange=${() => setPick(id)} />
            <${Flag} code=${b.driverById.get(id)?.country_code} size=${16} /> ${b.driverById.get(id)?.nick ?? '?'}
          </label>`)}
        </fieldset>`)}
        ${reserves.length && !showReserves && !custom ? html`<button type="button" class="btn btn-sm" onClick=${() => setShowReserves(true)}>Pokaż rezerwowych / zastępstwa (${reserves.length})</button>` : null}
      </div>
      <div class="form-actions">
        <button class="btn btn-accent" disabled=${!pick || busy}>${busy ? 'Zapisywanie…' : 'Głosuj'}</button>
        <button type="button" class="btn" onClick=${onClose}>Anuluj</button>
      </div>
    </form>`;
  }

  return html`<div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Głosowanie na kierowcę dnia">
      <header class="modal-head">
        <div><div class="eyebrow">⭐ Kierowca dnia</div>
          <h3><${Flag} code=${track?.country_code} size=${22} /> ${track?.name ?? 'Wyścig'}</h3>
          <div class="muted small">${b.season.name}</div></div>
        <button type="button" class="btn btn-sm" onClick=${onClose} aria-label="Zamknij">✕</button>
      </header>
      <div class="modal-body">${body}</div>
    </div>
  </div>`;
}

/** Bieżące wyniki (po oddaniu głosu albo po zamknięciu głosowania). */
function DotdLiveResults({ b, poll, onClose }) {
  const total = poll.results.reduce((n, r) => n + r.votes, 0);
  const teamOf = (id) => b.teamById.get(lineupAt(b.entries, b.rosterChanges, 999).get(id)?.team_id);
  return html`
    ${poll.my ? html`<p class="dotd-thanks">✓ Twój głos: <b>${b.driverById.get(poll.my)?.nick ?? '?'}</b></p>` : null}
    <p class="muted small">${poll.open ? `Wyniki na żywo · ${total} ${total === 1 ? 'głos' : total % 10 >= 2 && total % 10 <= 4 && (total % 100 < 12 || total % 100 > 14) ? 'głosy' : 'głosów'} · głosowanie trwa do końca wyścigu` : `Głosowanie zakończone · ${total} głosów`}</p>
    <ol class="dotd-results">
      ${poll.results.map((r, i) => {
        const pct = total ? Math.round((r.votes / total) * 100) : 0;
        return html`<li class=${`${r.driver_id === poll.my ? 'mine' : ''} ${i === 0 ? 'lead' : ''}`} style=${{ '--team': teamOf(r.driver_id)?.color || 'var(--gold)' }}>
          <span class="dotd-bar" style=${{ width: `${pct}%` }}></span>
          <span class="dotd-name">${i === 0 ? '⭐ ' : ''}${b.driverById.get(r.driver_id)?.nick ?? '?'}</span>
          <span class="dotd-pct"><b>${pct}%</b> <span class="muted">(${r.votes})</span></span>
        </li>`;
      })}
    </ol>
    <div class="form-actions"><button type="button" class="btn btn-accent" onClick=${onClose}>Zamknij</button></div>
  `;
}
