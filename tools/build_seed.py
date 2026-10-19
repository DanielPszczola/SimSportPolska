"""
Generuje startową bazę ligi z pliku wyniki_ligi.json.

    python tools/build_seed.py

Wynik:
  supabase/seed.sql  — dane do załadowania w Postgresie (Supabase) PO supabase/schema.sql
  js/seed-data.js    — te same dane dla trybu demo strony

Zasady konwersji:
  - "strata" w pliku to odstęp do POPRZEDNIEGO auta, więc sumujemy ją do straty względem zwycięzcy
    (time_ms = strata do zwycięzcy, zwycięzca = 0; całkowity czas wyścigu nie jest znany),
  - "+N LAP" -> ukończył z N okrążeniami straty, "DNF"/"DSQ" -> status, pusta strata -> ukończył bez czasu,
  - najszybsze okrążenie -> fastest_lap + best_lap_ms tego kierowcy (punktacja w pliku: bez punktu za NO),
  - skład startowy: w każdym zespole 2 kierowców z największą liczbą startów, pozostali to rezerwa
    (wyniki zawsze zachowują zespół, za który kierowca jechał w danym wyścigu),
  - identyfikatory są stałe (uuid5), więc skrypt można uruchamiać wielokrotnie.
"""
import json
import re
import uuid
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'wyniki_ligi.json'
NS = uuid.UUID('6f1c2d3e-5000-4000-8000-00000000055b')  # stała przestrzeń nazw dla identyfikatorów

def uid(*parts):
    return str(uuid.uuid5(NS, '/'.join(map(str, parts))))

# Grand Prix z pliku -> nazwa toru w bazie (js/tracks-seed.js, supabase/schema.sql)
GP_TRACK = {
    'Austria': 'Red Bull Ring', 'Wielka Brytania': 'Silverstone', 'Belgia': 'Spa-Francorchamps',
    'Azerbejdżan': 'Baku City Circuit', 'São Paulo': 'Interlagos', 'Australia': 'Albert Park',
    'Japonia': 'Suzuka', 'Katar': 'Lusail International Circuit', 'Emilia-Romania': 'Imola',
    'Abu Zabi': 'Yas Marina', 'Kanada': 'Circuit Gilles Villeneuve', 'Bahrajn': 'Bahrain International Circuit',
    'Madryt': 'Madring', 'Las Vegas': 'Las Vegas Strip Circuit', 'Meksyk': 'Autódromo Hermanos Rodríguez',
    'Arabia Saudyjska': 'Jeddah Corniche Circuit', 'Chiny': 'Shanghai International Circuit',
    'Chiny (2)': 'Shanghai International Circuit', 'Miami': 'Miami International Autodrome', 'Włochy': 'Monza',
}

# Wygląd zespołów w poszczególnych sezonach: (kolor, folder grafik w assets/teams lub None)
TEAM_LOOK = {
    1: {  # sezon z kalendarzem 2025 (Kick Sauber, bez Cadillaca)
        'Mercedes': ('#27F4D2', 'mercedes'), 'Ferrari': ('#E8002D', 'ferrari'), 'Williams': ('#64C4FF', 'williams'),
        'Haas': ('#B6BABD', 'haas'), 'McLaren': ('#FF8000', 'mclaren'), 'Racing Bulls': ('#6692FF', 'racing-bulls'),
        'Red Bull': ('#3671C6', 'red-bull'), 'Aston Martin': ('#229971', 'aston-martin'), 'Kick Sauber': ('#52E252', None),
        'Alpine': ('#FF87BC', 'alpine'),
    },
    2: {  # sezon z kalendarzem 2026 (Audi, Cadillac) — grafiki bolidów 2026
        'Red Bull': ('#3671C6', 'red-bull'), 'Aston Martin': ('#229971', 'aston-martin'), 'Cadillac': ('#D4AF37', 'cadillac'),
        'Williams': ('#1868DB', 'williams'), 'Audi': ('#FF2D1A', 'audi'), 'Alpine': ('#0093CC', 'alpine'),
        'Mercedes': ('#27F4D2', 'mercedes'), 'Racing Bulls': ('#6692FF', 'racing-bulls'), 'Haas': ('#B6BABD', 'haas'),
        'Ferrari': ('#E8002D', 'ferrari'), 'McLaren': ('#FF8000', 'mclaren'),
    },
}
CARS_FOR_SEASON = {2}  # dostępne grafiki bolidów są z 2026

def parse_seconds(s):
    m = re.fullmatch(r'\+(?:(\d+):)?(\d+),(\d+)', s)
    if not m:
        return None
    return (int(m[1] or 0) * 60 + int(m[2])) * 1000 + int(m[3].ljust(3, '0')[:3])

def parse_lap(s):
    m = re.fullmatch(r'(\d+):(\d+),(\d+)', s or '')
    return None if not m else (int(m[1]) * 60 + int(m[2])) * 1000 + int(m[3].ljust(3, '0')[:3])

def build():
    data = json.loads(SRC.read_text(encoding='utf-8'))
    seasons, teams, drivers, entries, races, results = [], [], {}, [], [], []
    season_nums = sorted({r['sezon'] for r in data})

    for sn in season_nums:
        sid = uid('season', sn)
        seasons.append({
            'id': sid, 'series': 'f1', 'name': f'Sezon {sn}', 'is_current': sn == season_nums[-1], 'format': 'league',
            'points': [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], 'fl_point': 0, 'fl_top10': True, 'pole_point': 0, 'finish_bonus': 0,
            'created_at': f'202{4 + sn}-01-01T00:00:00Z',
        })
        srace = sorted((r for r in data if r['sezon'] == sn), key=lambda r: r['runda'])
        team_names = sorted({w['zespol'] for r in srace for w in r['wyniki']})
        team_id = {}
        for name in team_names:
            color, slug = TEAM_LOOK.get(sn, {}).get(name, ('#888888', None))
            team_id[name] = uid('team', sn, name)
            teams.append({
                'id': team_id[name], 'season_id': sid, 'name': name, 'color': color,
                'logo_url': f'assets/teams/{slug}/logo.png' if slug else None,
                'car_url': f'assets/teams/{slug}/car-2026.png' if slug and sn in CARS_FOR_SEASON else None,
                'car_class': None,
            })

        # skład startowy: 2 kierowców z największą liczbą startów w zespole, reszta w rezerwie
        starts = Counter()
        first_seen = {}
        for r in srace:
            for w in r['wyniki']:
                starts[(w['kierowca'], w['zespol'])] += 1
                first_seen.setdefault((w['kierowca'], w['zespol']), (r['runda'], w['pozycja']))
        seat_of, filled = {}, Counter()
        for (drv, team), n in sorted(starts.items(), key=lambda kv: (-kv[1], first_seen[kv[0]])):
            if drv not in seat_of and filled[team] < 2:
                seat_of[drv] = team
                filled[team] += 1
        season_drivers = sorted({w['kierowca'] for r in srace for w in r['wyniki']}, key=str.lower)
        for nick in season_drivers:
            drivers.setdefault(nick, {'id': uid('driver', nick), 'nick': nick, 'country_code': None, 'number': None})
            team = seat_of.get(nick)
            entries.append({
                'id': uid('entry', sn, nick), 'season_id': sid, 'driver_id': drivers[nick]['id'],
                'team_id': team_id[team] if team else None, 'is_reserve': team is None,
            })

        for r in srace:
            rid = uid('race', sn, r['runda'])
            races.append({
                'id': rid, 'season_id': sid, 'round': r['runda'], 'track_name': GP_TRACK[r['gp']], 'gp': r['gp'],
                'race_date': None, 'laps': None, 'status': 'completed', 'counts': True, 'notes': '',
            })
            fl = r.get('najszybsze_okrazenie') or {}
            gap = 0  # skumulowana strata do zwycięzcy
            for w in r['wyniki']:
                s = str(w['strata']).strip()
                status, laps_down, time_ms = 'FIN', 0, None
                if s == 'LEADER':
                    time_ms = 0
                elif s in ('DNF', 'DSQ', 'DNS', 'NC'):
                    status = s
                elif re.fullmatch(r'\+(\d+) LAPS?', s):
                    laps_down = int(re.fullmatch(r'\+(\d+) LAPS?', s)[1])
                elif parse_seconds(s) is not None:
                    gap += parse_seconds(s)
                    time_ms = gap
                elif s:
                    raise ValueError(f'Nieznana strata {s!r} (S{sn} R{r["runda"]})')
                is_fl = fl.get('kierowca') == w['kierowca']
                results.append({
                    'id': uid('result', sn, r['runda'], w['kierowca']), 'race_id': rid, 'driver_id': drivers[w['kierowca']]['id'],
                    'team_id': team_id[w['zespol']], 'car_class': 'F1', 'position': w['pozycja'], 'grid': w['start'],
                    'status': status, 'laps_down': laps_down, 'time_ms': time_ms,
                    'best_lap_ms': parse_lap(fl.get('czas')) if is_fl else None, 'fastest_lap': is_fl, 'pit_stops': None,
                    '_points': w['punkty'],
                })
    return {'seasons': seasons, 'teams': teams, 'drivers': sorted(drivers.values(), key=lambda d: d['nick'].lower()),
            'entries': entries, 'races': races, 'results': results}

# ---------- zapis ----------

def sql_val(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "'{" + ','.join(map(str, v)) + "}'"
    return "'" + str(v).replace("'", "''") + "'"

def sql_insert(table, rows, cols, extra=None):
    lines = []
    for r in rows:
        vals = [sql_val(r[c]) for c in cols]
        if extra:
            vals += [e(r) for e in extra.values()]
        lines.append('  (' + ', '.join(vals) + ')')
    allcols = cols + (list(extra) if extra else [])
    return f'insert into public.{table} ({", ".join(allcols)}) values\n' + ',\n'.join(lines) + '\non conflict (id) do nothing;\n'

def write_sql(db):
    out = [
        '-- =====================================================================',
        '-- Sim Sport Polska — startowe dane ligi (sezony F1 z pliku wyniki_ligi.json)',
        '-- Wygenerowane przez: python tools/build_seed.py  (nie edytuj ręcznie)',
        '-- Uruchom w Supabase → SQL Editor PO pliku supabase/schema.sql.',
        '-- Bezpieczne do ponownego uruchomienia (on conflict do nothing).',
        '-- =====================================================================',
        'begin;',
        '',
        sql_insert('seasons', db['seasons'], ['id', 'series', 'name', 'is_current', 'format', 'points', 'fl_point', 'fl_top10', 'pole_point', 'finish_bonus', 'created_at']),
        sql_insert('teams', db['teams'], ['id', 'season_id', 'name', 'color', 'logo_url', 'car_url', 'car_class']),
        sql_insert('drivers', db['drivers'], ['id', 'nick', 'country_code', 'number']),
        sql_insert('entries', db['entries'], ['id', 'season_id', 'driver_id', 'team_id', 'is_reserve']),
        sql_insert('races', db['races'], ['id', 'season_id', 'round', 'race_date', 'laps', 'status', 'counts', 'notes'],
                   extra={'track_id': lambda r: f"(select id from public.tracks where name = {sql_val(r['track_name'])} and category = 'F1' limit 1)"}),
        sql_insert('results', db['results'], ['id', 'race_id', 'driver_id', 'team_id', 'car_class', 'position', 'grid', 'status', 'laps_down', 'time_ms', 'best_lap_ms', 'fastest_lap', 'pit_stops']),
        'commit;',
        '',
    ]
    (ROOT / 'supabase' / 'seed.sql').write_text('\n'.join(out), encoding='utf-8')

def write_js(db):
    clean = {k: [{kk: vv for kk, vv in r.items() if not kk.startswith('_')} for r in v] for k, v in db.items()}
    body = json.dumps(clean, ensure_ascii=False, separators=(',', ':'))
    (ROOT / 'js' / 'seed-data.js').write_text(
        '// Startowe dane ligi (sezony F1 z pliku wyniki_ligi.json).\n'
        '// Wygenerowane przez: python tools/build_seed.py  (nie edytuj ręcznie)\n'
        f'export const SEED = {body};\n', encoding='utf-8')

if __name__ == '__main__':
    db = build()
    write_sql(db)
    write_js(db)
    print(f"sezony: {len(db['seasons'])}, zespoły: {len(db['teams'])}, kierowcy: {len(db['drivers'])}, "
          f"składy: {len(db['entries'])}, wyścigi: {len(db['races'])}, wyniki: {len(db['results'])}")
