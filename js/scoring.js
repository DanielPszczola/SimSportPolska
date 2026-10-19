// Logika punktacji: klasyfikacja wyścigu po karach oraz klasyfikacje sezonu.
// Wszystko liczone jest "w locie" z surowych wyników + kar, więc nałożenie
// lub usunięcie kary od razu zmienia wyniki i klasyfikację generalną.

import { lineupAt } from './lineup.js';

export const DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export const STATUSES = [
  { id: 'FIN', label: 'Ukończył' },
  { id: 'DNF', label: 'DNF — nie ukończył' },
  { id: 'DNS', label: 'DNS — nie wystartował' },
  { id: 'DSQ', label: 'DSQ — dyskwalifikacja' },
  { id: 'NC', label: 'NC — niesklasyfikowany' },
];

// Klasy samochodów. Sezony F1 mają zawsze klasę F1; w LMU klasa jest zapisana przy każdym wyniku.
export const CAR_CLASSES = [
  { id: 'F1', label: 'Formuła 1', color: '#e10600' },
  { id: 'GT3', label: 'GT3', color: '#f97316' },
  { id: 'LMP', label: 'LMP', color: '#3b82f6' },
  { id: 'HY', label: 'Hypercar', color: '#f5c542' },
];
export const LMU_CLASSES = CAR_CLASSES.filter((c) => c.id !== 'F1');
export const carClass = (id) => CAR_CLASSES.find((c) => c.id === id);

/** Klasy jadące w sezonie (LMU: 1–3 klasy z ustawień sezonu; F1: brak podziału na klasy). */
export const seasonClasses = (season) => (season?.series === 'lmu' ? (season.classes?.length ? season.classes : ['HY', 'LMP', 'GT3']) : []);

/** Klasa wyniku: zapisana przy wyniku, a dla sezonów F1 zawsze 'F1'. */
export function resultClass(r, season) {
  if (season?.series === 'f1') return 'F1';
  return r.car_class || null;
}

export const PENALTY_TYPES = [
  { id: 'time', label: 'Kara czasowa (+s)' },
  { id: 'points', label: 'Odjęcie punktów' },
  { id: 'dsq', label: 'Dyskwalifikacja z wyścigu' },
  { id: 'grid', label: 'Cofnięcie na starcie (kolejny wyścig)' },
  { id: 'warning', label: 'Ostrzeżenie / upomnienie' },
];

export function penaltyLabel(p) {
  switch (p.type) {
    case 'time': return `+${p.value}s`;
    case 'points': return `−${p.value} pkt`;
    case 'dsq': return 'DSQ';
    case 'grid': return `Cofnięcie o ${p.value} poz. na starcie`;
    default: return 'Ostrzeżenie';
  }
}

// ---------- czasy ----------

// "1:32:15.123" | "32:15.123" | "95.123" | "95,123" -> ms
export function parseTime(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(',', '.');
  if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  let total = 0;
  for (const p of parts) total = total * 60 + p;
  return Math.round(total * 1000);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function formatDuration(ms) {
  if (ms == null) return '';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = pad(ms % 1000, 3);
  return h ? `${h}:${pad(m)}:${pad(s)}.${f}` : `${m}:${pad(s)}.${f}`;
}

export function formatGap(ms) {
  if (ms == null) return '';
  return ms < 60000 ? `+${Math.floor(ms / 1000)}.${pad(ms % 1000, 3)}` : `+${formatDuration(ms)}`;
}

// ---------- wyścig ----------

const UNCLASSIFIED_ORDER = { DNF: 0, NC: 0, DNS: 1, DSQ: 2 };

/**
 * Zwraca wiersze wyniku wyścigu po uwzględnieniu kar, w kolejności końcowej.
 * Każdy wiersz: dane wyniku + { finalPos, status, points, timePen, pointsPen,
 * adjTime, gapText, hasFastestLap, hasPole, posChange, penalties }.
 */
export function computeRace(race, season, results, penalties) {
  const pens = penalties.filter((p) => p.race_id === race.id);
  const rows = results
    .filter((r) => r.race_id === race.id)
    .map((r) => {
      const ps = pens.filter((p) => p.driver_id === r.driver_id);
      const timePen = ps.filter((p) => p.type === 'time').reduce((s, p) => s + (Number(p.value) || 0), 0);
      const pointsPen = ps.filter((p) => p.type === 'points').reduce((s, p) => s + (Number(p.value) || 0), 0);
      const status = ps.some((p) => p.type === 'dsq') ? 'DSQ' : r.status || 'FIN';
      const adjTime = r.time_ms != null ? Number(r.time_ms) + timePen * 1000 : null;
      return { ...r, status, timePen, pointsPen, adjTime, penalties: ps };
    });

  const classified = rows
    .filter((r) => r.status === 'FIN')
    .sort((a, b) =>
      (a.laps_down || 0) - (b.laps_down || 0) ||
      (a.adjTime != null && b.adjTime != null ? a.adjTime - b.adjTime : a.position - b.position));
  const others = rows
    .filter((r) => r.status !== 'FIN')
    .sort((a, b) => UNCLASSIFIED_ORDER[a.status] - UNCLASSIFIED_ORDER[b.status] || a.position - b.position);

  // najszybsze okrążenie: zaznaczone ręcznie albo najlepszy czas okrążenia
  const eligible = rows.filter((r) => r.status !== 'DSQ');
  let flHolder = eligible.find((r) => r.fastest_lap);
  if (!flHolder) {
    flHolder = eligible.filter((r) => r.best_lap_ms).sort((a, b) => a.best_lap_ms - b.best_lap_ms)[0];
  }

  const P = season?.points?.length ? season.points : DEFAULT_POINTS;
  const leaderTime = classified[0]?.adjTime ?? null;
  // czasy względne: znamy tylko straty do zwycięzcy (zwycięzca ma 0), nie całkowity czas wyścigu
  const relativeTimes = rows.some((r) => r.time_ms != null && Number(r.time_ms) === 0);
  const counts = race.counts !== false;

  return [...classified, ...others].map((r, i) => {
    const finished = r.status === 'FIN';
    const finalPos = finished ? i + 1 : null;
    const hasFastestLap = flHolder?.id === r.id;
    const hasPole = Number(r.grid) === 1;
    let points = 0;
    if (counts) {
      if (finished) {
        points += P[finalPos - 1] || 0;
        points += Number(season?.finish_bonus) || 0;
        if (hasFastestLap && (!season?.fl_top10 || finalPos <= 10)) points += Number(season?.fl_point) || 0;
      }
      if (hasPole && r.status !== 'DSQ') points += Number(season?.pole_point) || 0;
      points -= r.pointsPen;
    }
    let gapText = '';
    if (finished) {
      if (r.laps_down > 0) gapText = `+${r.laps_down} okr.`;
      else if (finalPos === 1) gapText = relativeTimes ? 'Zwycięzca' : formatDuration(r.adjTime);
      else if (r.adjTime != null && leaderTime != null) gapText = formatGap(r.adjTime - leaderTime);
    }
    return {
      ...r,
      finalPos,
      points,
      gapText,
      hasFastestLap,
      hasPole,
      posChange: finalPos && r.grid ? Number(r.grid) - finalPos : null,
    };
  });
}

// ---------- sezon ----------

function countback(a, b) {
  const n = Math.max(a.posCounts.length, b.posCounts.length);
  for (let i = 1; i < n; i++) {
    const d = (b.posCounts[i] || 0) - (a.posCounts[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Zasady liczenia punktów konstruktorów (ustawienie sezonu team_points); domyślnie 'final' — wg regulaminu ligi. */
export const TEAM_POINTS_MODES = [
  { id: 'final', label: 'Punkty odchodzą z kierowcą', desc: 'Zespół ma sumę punktów kierowców ze swojego obecnego składu (po wszystkich rotacjach). Kierowca, który odchodzi, zabiera swoje punkty, a nowy wnosi wszystkie swoje. Rezerwowi nie liczą się dla zespołu.' },
  { id: 'lineup', label: 'Punkty zostają w zespole', desc: 'Wynik zalicza się zespołowi, w którego składzie kierowca był w danej rundzie. Po rotacji zespół zachowuje punkty zdobyte przez poprzedniego kierowcę. Rezerwowi i zastępstwa nie zdobywają punktów dla zespołu.' },
  { id: 'result', label: 'Za zespół z wyniku', desc: 'Wynik zalicza się zespołowi, którym kierowca jechał w wyścigu (wpisanemu przy wyniku) — także rezerwowym.' },
];

/**
 * Do którego zespołu trafiają punkty wyniku w klasyfikacji konstruktorów — patrz TEAM_POINTS_MODES.
 * Bez danych o składzie (entries) zawsze liczy „za zespół z wyniku”.
 */
export function teamPointsResolver({ season, entries, rosterChanges }) {
  const mode = season?.team_points || 'final';
  if (mode === 'result' || !entries) return (race, row) => row.team_id || null;
  if (mode === 'final') {
    const seats = lineupAt(entries, rosterChanges, Infinity);
    return (race, row) => seats.get(row.driver_id)?.team_id || null;
  }
  const byRound = new Map();
  return (race, row) => {
    if (!byRound.has(race.round)) byRound.set(race.round, lineupAt(entries, rosterChanges, race.round));
    return byRound.get(race.round).get(row.driver_id)?.team_id || null;
  };
}

/** Klasyfikacja kierowców i konstruktorów + macierz wyników runda po rundzie. */
export function computeStandings({ season, races, results, penalties, entries, rosterChanges }) {
  const teamOf = teamPointsResolver({ season, entries, rosterChanges });
  const done = races.filter((r) => r.status === 'completed').sort((a, b) => a.round - b.round);
  const drivers = new Map();
  const teams = new Map();
  const getD = (id) => {
    if (!drivers.has(id)) drivers.set(id, { driver_id: id, points: 0, wins: 0, podiums: 0, poles: 0, fls: 0, starts: 0, best: null, posCounts: [], perRound: {}, team_id: null, teamIds: [] });
    return drivers.get(id);
  };
  const getT = (id) => {
    if (!teams.has(id)) teams.set(id, { team_id: id, points: 0, wins: 0, podiums: 0, posCounts: [], perRound: {} });
    return teams.get(id);
  };

  for (const race of done) {
    for (const row of computeRace(race, season, results, penalties)) {
      const d = getD(row.driver_id);
      d.points += row.points;
      d.team_id = row.team_id || d.team_id;
      if (row.team_id && !d.teamIds.includes(row.team_id)) d.teamIds.push(row.team_id); // wszystkie zespoły, dla których jechał
      if (row.status !== 'DNS') d.starts++;
      if (row.hasPole) d.poles++;
      if (row.hasFastestLap) d.fls++;
      if (row.finalPos) {
        d.posCounts[row.finalPos] = (d.posCounts[row.finalPos] || 0) + 1;
        if (row.finalPos === 1) d.wins++;
        if (row.finalPos <= 3) d.podiums++;
        d.best = d.best ? Math.min(d.best, row.finalPos) : row.finalPos;
      }
      d.perRound[race.id] = { pos: row.finalPos, status: row.status, points: row.points, fl: row.hasFastestLap, pole: row.hasPole };

      const teamId = teamOf(race, row);
      if (teamId) {
        const t = getT(teamId);
        t.points += row.points;
        t.perRound[race.id] = (t.perRound[race.id] || 0) + row.points;
        if (row.finalPos) {
          t.posCounts[row.finalPos] = (t.posCounts[row.finalPos] || 0) + 1;
          if (row.finalPos === 1) t.wins++;
          if (row.finalPos <= 3) t.podiums++;
        }
      }
    }
  }

  const sort = (arr) => arr.sort((a, b) => b.points - a.points || countback(a, b));
  return {
    races: done,
    drivers: sort([...drivers.values()]),
    teams: sort([...teams.values()]),
  };
}

/**
 * Wynik wyścigu liczony osobno dla każdej klasy (wyścigi wieloklasowe LMU).
 * Każdy wiersz dostaje carClass i classPos (pozycja w klasie). W F1 jest jedna klasa,
 * więc wynik jest identyczny jak z computeRace.
 */
export function computeRaceByClass(race, season, results, penalties) {
  const groups = new Map();
  for (const r of results) {
    if (r.race_id !== race.id) continue;
    const cls = resultClass(r, season) || '?';
    if (!groups.has(cls)) groups.set(cls, []);
    groups.get(cls).push(r);
  }
  const out = [];
  for (const [cls, rows] of groups) {
    for (const row of computeRace(race, season, rows, penalties)) out.push({ ...row, carClass: cls, classPos: row.finalPos });
  }
  return out;
}
