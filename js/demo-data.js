// Dane trybu demo:
//  - F1: prawdziwe wyniki ligi (sezony 1–2) z js/seed-data.js — te same, co w supabase/seed.sql,
//  - LMU: przykładowy sezon wieloklasowy ze zmyślonymi kierowcami (sekcja LMU jest dopiero w przygotowaniu).
import { TRACKS_SEED } from './tracks-seed.js';
import { DEFAULT_POINTS } from './scoring.js';
import { SEED } from './seed-data.js';

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function buildDemoData(uid) {
  const now = new Date().toISOString();
  const tracks = TRACKS_SEED.map((t) => ({ id: uid(), created_at: now, ...t }));
  // tor wskazujemy po nazwie i kategorii (ten sam obiekt istnieje osobno dla F1 i każdej klasy LMU)
  const trackByName = (n, category = 'F1') => tracks.find((t) => t.name === n && t.category === category);
  const stamp = (r) => ({ created_at: now, ...r });

  const f1Races = SEED.races.map(({ track_name, gp, ...r }) => stamp({ ...r, track_id: trackByName(track_name).id }));
  const lmu = buildLmuDemo({ uid, now, tracks, trackByName });
  const other = buildOtherEventsDemo({ uid, now, tracks, trackByName, drivers: lmu.drivers });

  return {
    tracks,
    seasons: [...SEED.seasons, lmu.season, ...other.seasons],
    teams: [...SEED.teams.map(stamp), ...lmu.teams, ...other.teams],
    drivers: [...SEED.drivers.map(stamp), ...lmu.drivers],
    entries: [...SEED.entries.map(stamp), ...lmu.entries, ...other.entries],
    races: [...f1Races, ...lmu.races, ...other.races],
    results: [...SEED.results.map(stamp), ...lmu.results, ...other.results],
    penalties: [],
    roster_changes: [],
    ...buildEnduranceDemo({ uid, now, trackByName, drivers: lmu.drivers }),
    ...buildOtherDemo({ uid, now }),
  };
}

// ---------- przykładowy sezon LMU (fikcyjny) ----------

const LMU_NICKS = ['Demo_Hyper1', 'Demo_Hyper2', 'Demo_Hyper3', 'Demo_Hyper4', 'Demo_LMP1', 'Demo_LMP2', 'Demo_LMP3', 'Demo_LMP4', 'Demo_GT1', 'Demo_GT2', 'Demo_GT3', 'Demo_GT4'];
// liga LMU: zamiast zespołów samochody (marka/model); każdym autem jedzie dwóch kierowców demo
const LMU_TEAMS = [
  ['BMW M Hybrid V8', '#1c69d4', 'HY'], ['Ferrari 499P', '#dc0000', 'HY'],
  ['Oreca 07 Gibson (LMP2)', '#3b82f6', 'LMP'], ['Ligier JS P325 (LMP3)', '#1e40af', 'LMP'],
  ['Ford Mustang LMGT3', '#2f6fd6', 'GT3'], ['Porsche 911 GT3 R LMGT3', '#d5001c', 'GT3'],
];
// tempo klasy (km/s) i strata okrążeń do lidera wyścigu
const LMU_PACE = { HY: [0.058, 0], LMP: [0.054, 1], GT3: [0.048, 3] };

function buildLmuDemo({ uid, now, tracks, trackByName }) {
  const rand = rng(2026);
  const season = {
    id: uid(), created_at: now, series: 'lmu', name: 'LMU — sezon demonstracyjny', is_current: true, format: 'league', classes: ['HY', 'LMP', 'GT3'],
    points: DEFAULT_POINTS, fl_point: 0, fl_top10: false, pole_point: 1, finish_bonus: 0,
  };
  const drivers = LMU_NICKS.map((nick) => ({ id: uid(), created_at: now, nick, country_code: null, number: null }));
  const skill = drivers.map(() => rand());
  const teams = LMU_TEAMS.map(([name, color, car_class]) => ({ id: uid(), created_at: now, season_id: season.id, name, color, logo_url: '', car_url: '', car_class }));
  const entries = drivers.map((d, i) => ({ id: uid(), created_at: now, season_id: season.id, driver_id: d.id, team_id: teams[Math.floor(i / 2)].id, is_reserve: false }));

  // runda 3 zawsze w przyszłości, dwie pierwsze rozegrane
  const day = 86400000;
  const base = new Date();
  base.setHours(20, 0, 0, 0);
  const races = [['Spa-Francorchamps', -20, 'completed'], ['Monza', -6, 'completed'], ['Circuit de la Sarthe (Le Mans)', 13, 'scheduled']].map(([n, offset, status], i) => {
    const track = trackByName(n, 'HY');
    return {
      id: uid(), created_at: now, season_id: season.id, round: i + 1, track_id: track.id,
      race_date: new Date(base.getTime() + offset * day).toISOString(),
      laps: Math.round(400 / track.length_km), status, counts: true, notes: '',
    };
  });

  const results = [];
  for (const race of races.filter((r) => r.status === 'completed')) {
    const track = tracks.find((t) => t.id === race.track_id);
    let position = 0;
    for (const cls of ['HY', 'LMP', 'GT3']) {
      const [pace, lapsDown] = LMU_PACE[cls];
      const lapMs = (track.length_km / pace) * 1000;
      const clsEntries = entries.filter((e) => teams.find((t) => t.id === e.team_id).car_class === cls);
      let time = Math.round((race.laps - lapsDown) * lapMs + rand() * 30000);
      clsEntries
        .map((e) => ({ e, v: skill[drivers.findIndex((d) => d.id === e.driver_id)] + rand() * 0.6 }))
        .sort((a, b) => b.v - a.v)
        .forEach(({ e }, k) => {
          position++;
          if (k > 0) time += Math.round(2000 + rand() * 25000);
          const dnf = rand() < 0.08;
          results.push({
            id: uid(), created_at: now, race_id: race.id, driver_id: e.driver_id, team_id: e.team_id, car_class: cls,
            position, grid: position, status: dnf ? 'DNF' : 'FIN', laps_down: lapsDown,
            time_ms: dnf ? null : time, best_lap_ms: Math.round(lapMs * (0.95 + rand() * 0.03)),
            fastest_lap: false, pit_stops: 3 + Math.floor(rand() * 3),
          });
        });
    }
  }
  return { season, drivers, teams, entries, races, results };
}

// ---------- przykładowe wyścigi długodystansowe (fikcyjne) ----------

function buildEnduranceDemo({ uid, now, trackByName, drivers }) {
  const day = 86400000;
  const at = (offsetDays, hour) => {
    const d = new Date(Date.now() + offsetDays * day);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const ids = (...nicks) => nicks.map((n) => drivers.find((d) => d.nick === n).id);
  const event = (name, track, cat, start, hours, status) => ({
    id: uid(), created_at: now, name, track_id: trackByName(track, cat).id, start_at: start, duration_hours: hours,
    stream_url: null, status, notes: '',
  });
  const spa = event('6h Spa', 'Spa-Francorchamps', 'HY', at(-12, 14), 6, 'finished');
  const lemans = event('24h Le Mans', 'Circuit de la Sarthe (Le Mans)', 'HY', at(18, 16), 24, 'scheduled');
  const bahrain = event('8h Bahrain', 'Bahrain International Circuit', 'GT3', at(40, 12), 8, 'scheduled');
  const crew = (ev, n, car_class, car_model, driver_ids, result = {}) => ({
    id: uid(), created_at: now, event_id: ev.id, name: `Sim Sport Polska #${n}`, car_class, car_number: String(n * 11), car_model,
    car_image_url: null, driver_ids, result_status: null, position_class: null, position_overall: null, laps: null, result_note: '', hall_of_fame: false, ...result,
  });
  return {
    endurance_events: [spa, lemans, bahrain],
    endurance_crews: [
      crew(spa, 1, 'HY', 'Porsche 963', ids('Demo_Hyper1', 'Demo_Hyper2', 'Demo_Hyper3'), { result_status: 'FIN', position_class: 4, position_overall: 4, laps: 168 }),
      crew(spa, 2, 'GT3', 'BMW M4 GT3', ids('Demo_GT1', 'Demo_GT2'), { result_status: 'FIN', position_class: 2, position_overall: 21, laps: 149, hall_of_fame: true }),
      crew(lemans, 1, 'HY', 'Porsche 963', ids('Demo_Hyper1', 'Demo_Hyper2', 'Demo_Hyper4')),
      crew(lemans, 2, 'LMP', 'Oreca 07', ids('Demo_LMP1', 'Demo_LMP2', 'Demo_LMP3')),
      crew(lemans, 3, 'GT3', 'Ford Mustang GT3', ids('Demo_GT3', 'Demo_GT4')),
      crew(bahrain, 1, 'GT3', 'BMW M4 GT3', ids('Demo_GT1', 'Demo_GT2', 'Demo_GT4')),
    ],
  };
}

// ---------- open lobby i ogłoszenia (fikcyjne) ----------

function buildOtherDemo({ uid, now }) {
  const hour = 3600000;
  const iso = (offsetHours) => new Date(Date.now() + offsetHours * hour).toISOString();
  const lobby = (title, game, cars, start, extra = {}) => ({
    id: uid(), created_at: now, title, game, cars, start_at: start, duration_minutes: 120, description: '', status: 'auto',
    youtube_url: null, twitch_url: null, tiktok_url: null, discord_url: null, ...extra,
  });
  return {
    lobbies: [
      lobby('Czwartkowe open lobby GT3', 'Le Mans Ultimate', 'GT3', iso(-0.5), {
        description: 'Spa-Francorchamps, 3 × 30 minut. Wejście przez kanał głosowy na Discordzie.',
        youtube_url: 'https://www.youtube.com/watch?v=4xDzrJKXOOY', twitch_url: 'https://www.twitch.tv/', discord_url: 'https://discord.com/',
      }),
      lobby('Niedzielne open lobby F1', 'F1 25', 'Dowolny zespół', iso(24 * 3 + 2), { twitch_url: 'https://www.twitch.tv/', tiktok_url: 'https://www.tiktok.com/' }),
      lobby('Open lobby Hypercar', 'Le Mans Ultimate', 'Hypercar', iso(-24 * 7), { youtube_url: 'https://www.youtube.com/' }),
    ],
    posts: [
      {
        id: uid(), created_at: new Date(Date.now() - 2 * 86400000).toISOString(), title: 'Witamy na nowej stronie ligi!', image_url: 'assets/hero.jpg', pinned: true, author: 'admin',
        body: 'Tutaj będą pojawiać się ogłoszenia ligi: zapisy na wydarzenia, zmiany w regulaminie i inne informacje.\nRegulamin i kalendarze znajdziecie w zakładkach F1 i Le Mans Ultimate.',
      },
      {
        id: uid(), created_at: new Date(Date.now() - 5 * 86400000).toISOString(), title: 'Open lobby co czwartek', image_url: null, pinned: false, author: 'admin',
        body: 'Od teraz w każdy czwartek o 20:00 zapraszamy na open lobby w Le Mans Ultimate. Szczegóły w zakładce Eventy → Open lobby.',
      },
    ],
  };
}

// ---------- wydarzenia „Inne” (fikcyjne): seria F2 (zespoły) i pojedyncze wydarzenie z własnymi klasami (auta) ----------

function buildOtherEventsDemo({ uid, now, tracks, trackByName, drivers }) {
  const rand = rng(77);
  const day = 86400000;
  const at = (offsetDays) => {
    const d = new Date(Date.now() + offsetDays * day);
    d.setHours(20, 0, 0, 0);
    return d.toISOString();
  };
  const seasonBase = { created_at: now, is_current: false, format: 'league', classes: ['HY', 'LMP', 'GT3'], fl_top10: true, pole_point: 0, finish_bonus: 0, team_points: 'final' };

  // seria F2: 4 zespoły po 2 kierowców, 3 rundy (2 rozegrane)
  const f2 = {
    ...seasonBase, id: uid(), series: 'inne', name: 'Puchar F2 — jesień', points: DEFAULT_POINTS, fl_point: 1,
    event_format: 'series', roster_mode: 'teams', class_defs: [{ id: 'F2', label: 'F2', color: '#0090d0' }],
    description: 'Krótka seria w bolidach F2 — trzy rundy, klasyfikacja kierowców i zespołów.',
  };
  const f2Teams = [['Prema', '#e30613'], ['ART Grand Prix', '#9ca3af'], ['Hitech', '#f8fafc'], ['Campos', '#f59e0b']]
    .map(([name, color]) => ({ id: uid(), created_at: now, season_id: f2.id, name, color, logo_url: '', car_url: '', car_class: null }));
  const f2Drivers = drivers.slice(0, 8);
  const f2Entries = f2Drivers.map((d, i) => ({ id: uid(), created_at: now, season_id: f2.id, driver_id: d.id, team_id: f2Teams[Math.floor(i / 2)].id, is_reserve: false }));
  const f2Races = [['Monza', -14, 'completed'], ['Imola', -4, 'completed'], ['Silverstone', 6, 'scheduled']].map(([n, offset, status], i) => ({
    id: uid(), created_at: now, season_id: f2.id, round: i + 1, track_id: trackByName(n, 'F1').id, race_date: at(offset),
    laps: 20, status, counts: true, notes: '', kind: 'race', duration_minutes: 90,
  }));
  // runda 3 trwa właśnie teraz (od 20 minut), z transmisją — sekcja „Trwa teraz” na stronie głównej
  Object.assign(f2Races[2], {
    race_date: new Date(Date.now() - 20 * 60000).toISOString(),
    youtube_url: 'https://www.youtube.com/live/4xDzrJKXOOY', twitch_url: 'https://www.twitch.tv/',
  });
  const results = [];
  for (const race of f2Races.filter((r) => r.status === 'completed')) {
    const track = tracks.find((t) => t.id === race.track_id);
    const lapMs = (track.length_km / 0.062) * 1000;
    let time = Math.round(race.laps * lapMs);
    f2Entries.map((e) => ({ e, v: rand() })).sort((a, b) => b.v - a.v).forEach(({ e }, k) => {
      if (k) time += Math.round(1500 + rand() * 9000);
      results.push({
        id: uid(), created_at: now, race_id: race.id, driver_id: e.driver_id, team_id: e.team_id, car_class: 'F2',
        position: k + 1, grid: k + 1, status: 'FIN', laps_down: 0, time_ms: time, best_lap_ms: Math.round(lapMs * (0.96 + rand() * 0.02)),
        fastest_lap: k === 2, pit_stops: 1,
      });
    });
  }

  // pojedyncze wydarzenie: własne klasy GT3 i GT4, auta z przypisanymi kierowcami
  const cup = {
    ...seasonBase, id: uid(), series: 'inne', name: 'Charytatywne 2h Spa', points: DEFAULT_POINTS, fl_point: 0,
    event_format: 'single', roster_mode: 'cars',
    class_defs: [{ id: 'GT3', label: 'GT3', color: '#f97316' }, { id: 'GT4', label: 'GT4', color: '#22c55e' }],
    description: 'Jednorazowy wyścig dwóch klas — GT3 i GT4.',
  };
  const cupTeams = [['Porsche 911 GT3 R', '#d5001c', 'GT3'], ['BMW M4 GT3', '#1c69d4', 'GT3'], ['Aston Martin Vantage GT4', '#00665e', 'GT4'], ['Toyota GR Supra GT4', '#e5e7eb', 'GT4']]
    .map(([name, color, car_class]) => ({ id: uid(), created_at: now, season_id: cup.id, name, color, logo_url: '', car_url: '', car_class }));
  const cupEntries = drivers.slice(4, 12).map((d, i) => ({ id: uid(), created_at: now, season_id: cup.id, driver_id: d.id, team_id: cupTeams[Math.floor(i / 2)].id, is_reserve: false }));
  const cupRace = {
    id: uid(), created_at: now, season_id: cup.id, round: 1, track_id: trackByName('Spa-Francorchamps', 'GT3').id, race_date: at(9),
    laps: null, status: 'scheduled', counts: true, notes: '', kind: 'race', weather: null, game_time: null,
  };

  return {
    seasons: [f2, cup],
    teams: [...f2Teams, ...cupTeams],
    entries: [...f2Entries, ...cupEntries],
    races: [...f2Races, cupRace],
    results,
  };
}
