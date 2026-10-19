// Skład zespołów w danej rundzie sezonu.
//
// entries        = skład na START sezonu (kto w jakim zespole, kto w rezerwie),
// roster_changes = zmiany wprowadzane PO wyścigu, obowiązujące od rundy from_round.
//
// Skład na rundę N = skład startowy + wszystkie zmiany z from_round <= N.
// Wyniki nie zależą od składu: każdy wynik pamięta zespół, dla którego został zdobyty.

/** Map(driver_id -> { driver_id, team_id | null }) — team_id null oznacza rezerwę. */
export function lineupAt(entries, changes, round) {
  const seats = new Map();
  for (const e of entries) seats.set(e.driver_id, { driver_id: e.driver_id, team_id: e.is_reserve ? null : e.team_id || null });
  const applied = (changes || [])
    .filter((c) => c.from_round <= round)
    .sort((a, b) => a.from_round - b.from_round || String(a.created_at).localeCompare(String(b.created_at)));
  for (const c of applied) {
    if (c.driver_out_id) seats.set(c.driver_out_id, { driver_id: c.driver_out_id, team_id: null });
    if (c.driver_in_id) seats.set(c.driver_in_id, { driver_id: c.driver_in_id, team_id: c.team_id });
  }
  return seats;
}

export const bundleLineup = (b, round = Infinity) => lineupAt(b.entries, b.rosterChanges, round);

export const teamSeats = (seats, teamId) => [...seats.values()].filter((s) => s.team_id === teamId);

export const reserveSeats = (seats) => [...seats.values()].filter((s) => !s.team_id);
