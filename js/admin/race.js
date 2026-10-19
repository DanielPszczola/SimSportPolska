import { useState, useMemo } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, unit, Flag, TeamTag, TeamLogo, PosBadge, attempt, formatDate } from '../ui.js';
import {
  computeRaceByClass, computeStandings, parseTime, formatDuration, penaltyLabel, carClass,
  STATUSES, PENALTY_TYPES, CAR_CLASSES, LMU_CLASSES, seasonClasses,
} from '../scoring.js';
import { lineupAt, teamSeats, reserveSeats } from '../lineup.js';
import { StepBar, NextStep } from './common.js';

// ---------- kafelek wyścigu ----------

export function RacePanel({ b, race, step, nav, reload }) {
  const track = b.trackById.get(race.track_id);
  const results = b.results.filter((r) => r.race_id === race.id);
  const pens = b.penalties.filter((p) => p.race_id === race.id);
  const changes = b.rosterChanges.filter((c) => c.from_round === race.round + 1);
  const unapprovedBefore = b.races.filter((r) => r.round < race.round && r.status !== 'completed');
  const done = race.status === 'completed';

  const steps = [
    { id: 'wyniki', label: 'Wyniki', note: results.length ? `${results.length} kierowców` : 'do wpisania', state: results.length ? 'done' : 'todo' },
    { id: 'kary', label: 'Kary', note: pens.length ? `${pens.length} decyzji` : 'brak kar', state: !results.length ? 'todo' : pens.length ? 'done' : 'info' },
    { id: 'sklady', label: b.season.series === 'lmu' ? 'Zmiany aut' : 'Zmiany w składach', note: changes.length ? `${changes.length} od R${race.round + 1}` : 'bez zmian', state: changes.length ? 'done' : 'info' },
    { id: 'zatwierdzenie', label: 'Zatwierdzenie', note: done ? 'opublikowany' : 'nieopublikowany', state: done ? 'done' : 'todo' },
  ];
  const current = steps.some((s) => s.id === step) ? step : !results.length ? 'wyniki' : done ? 'zatwierdzenie' : 'kary';
  const idx = steps.findIndex((s) => s.id === current);
  const go = (id) => nav(race.id, id);

  return html`<section class="panel">
    <div class="panel-head">
      <div class="panel-title">
        <${Flag} code=${track?.country_code} size=${36} />
        <div>
          <span class="eyebrow">Runda ${race.round} z ${b.races.length}</span>
          <h2>${track?.name ?? 'Tor'}</h2>
          <div class="muted">${formatDate(race.race_date)}${race.laps ? ` · ${race.laps} okr.` : ''}${race.counts === false ? ' · nie liczy się do klasyfikacji' : ''}</div>
        </div>
      </div>
      <span class=${`tile-state ${done ? 'st-done' : results.length ? 'st-draft' : 'st-next'}`}>${done ? '✓ Zatwierdzony' : results.length ? 'Do zatwierdzenia' : 'Bez wyników'}</span>
    </div>
    ${unapprovedBefore.length ? html`<p class="hint warn">Uwaga: niezatwierdzone wcześniejsze rundy: ${unapprovedBefore.map((r) => `R${r.round}`).join(', ')}. Skład na ten wyścig może się jeszcze zmienić.</p>` : null}
    <${StepBar} steps=${steps} value=${current} onChange=${go} />
    <div class="panel-body">
      ${current === 'wyniki' ? html`<${ResultsForm} key=${race.id + results.length} b=${b} race=${race} onSaved=${reload} />` : null}
      ${current === 'kary' ? html`<${RacePenalties} b=${b} race=${race} reload=${reload} />` : null}
      ${current === 'sklady' ? html`<${RosterAfterRace} b=${b} race=${race} reload=${reload} />` : null}
      ${current === 'zatwierdzenie' ? html`<${RaceSummary} b=${b} race=${race} nav=${nav} reload=${reload} />` : null}
    </div>
    ${idx < steps.length - 1 ? html`<${NextStep} label=${`Dalej: ${steps[idx + 1].label}`} onClick=${() => go(steps[idx + 1].id)} />` : null}
  </section>`;
}

// ---------- krok 1: wyniki ----------

let keySeq = 0;
const blankRow = () => ({ key: ++keySeq, driver_id: '', team_id: '', car_class: '', grid: '', status: 'FIN', time: '', laps_down: 0, best_lap: '', fastest_lap: false, pit_stops: '' });

function rowsFromResults(results) {
  return results.slice().sort((a, c) => a.position - c.position).map((r) => ({
    key: ++keySeq,
    driver_id: r.driver_id,
    team_id: r.team_id || '',
    car_class: r.car_class || '',
    grid: r.grid ?? '',
    status: r.status || 'FIN',
    time: r.time_ms != null ? formatDuration(r.time_ms) : '',
    laps_down: r.laps_down || 0,
    best_lap: r.best_lap_ms != null ? formatDuration(r.best_lap_ms) : '',
    fastest_lap: !!r.fastest_lap,
    pit_stops: r.pit_stops ?? '',
  }));
}

/** Zamienia wiersze formularza na rekordy tabeli results (z walidacją). */
function toRecords(rows, raceId, series) {
  const used = new Set();
  let winnerMs = null;
  return rows.map((r, i) => {
    if (!r.driver_id) throw new Error(`Pozycja ${i + 1}: wybierz kierowcę`);
    if (used.has(r.driver_id)) throw new Error(`Pozycja ${i + 1}: kierowca występuje dwa razy`);
    used.add(r.driver_id);
    if (series !== 'f1' && !r.car_class) throw new Error(`Pozycja ${i + 1}: wybierz klasę samochodu`);

    let time_ms = null;
    const t = String(r.time).trim();
    if (t && r.status === 'FIN') {
      if (t.startsWith('+')) {
        if (winnerMs == null) throw new Error(`Pozycja ${i + 1}: strata "+…" wymaga pełnego czasu zwycięzcy w 1. wierszu`);
        const gap = parseTime(t.slice(1));
        if (gap == null) throw new Error(`Pozycja ${i + 1}: nieprawidłowa strata "${t}"`);
        time_ms = winnerMs + gap;
      } else {
        time_ms = parseTime(t);
        if (time_ms == null) throw new Error(`Pozycja ${i + 1}: nieprawidłowy czas "${t}"`);
      }
      if (winnerMs == null) winnerMs = time_ms;
    }
    const best = String(r.best_lap).trim();
    const best_lap_ms = best ? parseTime(best) : null;
    if (best && best_lap_ms == null) throw new Error(`Pozycja ${i + 1}: nieprawidłowy czas okrążenia "${best}"`);

    return {
      race_id: raceId,
      driver_id: r.driver_id,
      team_id: r.team_id || null,
      car_class: series === 'f1' ? 'F1' : r.car_class,
      position: i + 1,
      grid: r.grid === '' ? null : Number(r.grid),
      status: r.status,
      laps_down: Number(r.laps_down) || 0,
      time_ms,
      best_lap_ms,
      fastest_lap: !!r.fastest_lap,
      pit_stops: r.pit_stops === '' ? null : Number(r.pit_stops),
    };
  });
}

function ResultsForm({ b, race, onSaved }) {
  const existing = b.results.filter((r) => r.race_id === race.id);
  const seats = lineupAt(b.entries, b.rosterChanges, race.round); // skład obowiązujący w tej rundzie
  const multiClass = b.season.series !== 'f1';
  const classOptions = seasonClasses(b.season);
  // przy jednej klasie w sezonie ustawiamy ją automatycznie
  const teamClass = (teamId) => b.teamById.get(teamId)?.car_class || (classOptions.length === 1 ? classOptions[0] : '');
  const seatTeam = (driverId) => seats.get(driverId)?.team_id || '';
  // lista startuje pusta — admin dodaje kierowców wiersz po wierszu, w kolejności na mecie
  const [rows, setRows] = useState(() => (existing.length ? rowsFromResults(existing) : []));
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extraDrivers, setExtraDrivers] = useState([]);
  const drivers = [...b.drivers, ...extraDrivers];
  const chosen = new Set(rows.map((r) => r.driver_id).filter(Boolean));
  const inLineup = drivers.filter((d) => seats.get(d.id)?.team_id);
  const inReserve = drivers.filter((d) => seats.has(d.id) && !seats.get(d.id).team_id);
  const others = drivers.filter((d) => !seats.has(d.id));

  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // najszybsze okrążenie jest jedno na klasę
  const setFastest = (i) => setRows(rows.map((r, j) => ({ ...r, fastest_lap: j === i ? !r.fastest_lap : r.car_class === rows[i].car_class ? false : r.fastest_lap })));
  const moveTo = (i, target) => {
    const j = Math.max(0, Math.min(rows.length - 1, target));
    if (j === i || Number.isNaN(j)) return;
    const next = rows.slice();
    const [row] = next.splice(i, 1);
    next.splice(j, 0, row);
    setRows(next);
  };
  const removeRow = (i) => setRows(rows.filter((_, j) => j !== i));
  const addRow = (driverId = '') => {
    const team_id = driverId ? seatTeam(driverId) : '';
    setRows([...rows, { ...blankRow(), driver_id: driverId, team_id, car_class: teamClass(team_id) }]);
  };
  // kierowcy ze składu tej rundy, których jeszcze nie ma na liście
  const missing = b.teams.flatMap((t) => teamSeats(seats, t.id)).filter((s) => !chosen.has(s.driver_id));

  const preview = useMemo(() => {
    try {
      const recs = toRecords(rows.filter((r) => r.driver_id), race.id, b.season.series).map((r, i) => ({ ...r, id: `tmp${i}` }));
      return { map: new Map(computeRaceByClass(race, b.season, recs, b.penalties).map((r) => [r.driver_id, r])) };
    } catch (e) {
      return { map: new Map(), error: e.message };
    }
  }, [rows, b]);

  const save = async () => {
    let records;
    try {
      records = toRecords(rows, race.id, b.season.series);
    } catch (e) {
      return alert(e.message);
    }
    if (!records.length) return alert('Dodaj co najmniej jednego kierowcę');
    setBusy(true);
    const ok = await attempt(async () => {
      await db.removeWhere('results', { race_id: race.id });
      await db.insert('results', records);
    }, 'Zapisano wyniki. Dalej: kary i zatwierdzenie.');
    setBusy(false);
    if (ok) onSaved();
  };
  const clearAll = async () => {
    if (!confirm('Usunąć wszystkie wyniki tego wyścigu? Wyścig zostanie też odpublikowany.')) return;
    const ok = await attempt(async () => {
      await db.removeWhere('results', { race_id: race.id });
      await db.update('races', race.id, { status: 'scheduled' });
    }, 'Wyniki usunięte');
    if (ok) onSaved();
  };

  const opts = (list, row) => list.map((d) => html`<option value=${d.id} disabled=${chosen.has(d.id) && d.id !== row.driver_id}>${d.nick}</option>`);
  // zmiana kierowcy przestawia też zespół (i klasę) na jego skład w tej rundzie — chyba że zespół
  // ustawiono w tym wierszu ręcznie (zastępstwo); wcześniej zespół zostawał od poprzedniego kierowcy
  const driverSelect = (row, i) => html`<select value=${row.driver_id} onChange=${(e) => {
    const team_id = row.teamManual ? row.team_id : seatTeam(e.target.value);
    setRow(i, { driver_id: e.target.value, team_id, car_class: row.teamManual ? row.car_class : teamClass(team_id) || row.car_class });
  }}>
    <option value="">— kierowca —</option>
    <optgroup label=${`Skład na rundę ${race.round}`}>${opts(inLineup, row)}</optgroup>
    ${inReserve.length ? html`<optgroup label="Rezerwa">${opts(inReserve, row)}</optgroup>` : null}
    ${others.length ? html`<optgroup label="Spoza składu sezonu">${opts(others, row)}</optgroup>` : null}
  </select>`;

  return html`
    <div class="form-actions">
      ${existing.length ? html`<span class="badge">Edycja zapisanych wyników</span>` : null}
      <button class="btn btn-sm" onClick=${() => setShowPaste(!showPaste)}>${showPaste ? 'Ukryj import' : 'Wklej wyniki z tekstu'}</button>
    </div>
    ${showPaste ? html`<${PasteImport} b=${b} seats=${seats} onImport=${(r, created) => { setExtraDrivers([...extraDrivers, ...created]); setRows(r); setShowPaste(false); }} />` : null}

    <p class="hint">Dodawaj kierowców w kolejności na mecie (przed karami): pierwszy wiersz to P1, drugi P2 i tak dalej.
      Pomyłkę poprawisz strzałkami albo usuwając wiersz. Czas: pełny dla zwycięzcy
      (np. <code>1:28:33.412</code>), dla pozostałych pełny albo strata (np. <code>+3.215</code>). Zastępstwo: wybierz kierowcę z rezerwy i zespół, za który jechał.
      ${multiClass ? ' Wyścig wieloklasowy: kolejność ogólna, a punkty liczą się w każdej klasie osobno.' : ''}</p>

    <div class="table-wrap">
      <table class="table edit-table results-edit">
        <thead><tr>
          <th class="c">Poz</th><th>Kierowca</th><th>${unit(b.season.series).one}</th>${multiClass ? html`<th>Klasa</th>` : null}<th class="c">Start</th><th>Status</th>
          <th>Czas / strata</th><th class="c" title="Okrążenia straty do lidera">Okr.−</th><th>Najl. okr.</th><th class="c" title="Najszybsze okrążenie">NO</th><th class="c">Pit</th>
          <th class="r">Pkt</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.map((row, i) => {
            const p = preview.map.get(row.driver_id);
            const sub = row.driver_id && row.team_id && seatTeam(row.driver_id) !== row.team_id;
            return html`<tr key=${row.key} class=${sub ? 'row-sub' : ''}>
              <td class="c"><span class="pos-fixed">P${i + 1}</span></td>
              <td>${driverSelect(row, i)}${sub ? html`<span class="badge" title=${multiClass ? 'Inne auto niż przypisane w tej rundzie' : 'Jedzie za inny zespół niż w składzie'}>${multiClass ? 'inne auto' : 'zastępstwo'}</span>` : null}</td>
              <td><select value=${row.team_id} onChange=${(e) => setRow(i, { team_id: e.target.value, teamManual: true, car_class: teamClass(e.target.value) || row.car_class })}>
                <option value="">—</option>
                ${b.teams.map((t) => html`<option value=${t.id}>${t.name}</option>`)}
              </select></td>
              ${multiClass ? html`<td><select value=${row.car_class} onChange=${(e) => setRow(i, { car_class: e.target.value })}>
                <option value="">—</option>
                ${LMU_CLASSES.filter((c) => classOptions.includes(c.id)).map((c) => html`<option value=${c.id}>${c.id}</option>`)}
              </select></td>` : null}
              <td class="c"><input class="w-num" type="number" min="1" value=${row.grid} onInput=${(e) => setRow(i, { grid: e.target.value })} /></td>
              <td><select value=${row.status} onChange=${(e) => setRow(i, { status: e.target.value })}>
                ${STATUSES.map((s) => html`<option value=${s.id}>${s.id}</option>`)}
              </select></td>
              <td><input class="w-time mono" value=${row.time} placeholder=${i === 0 ? '1:28:33.412' : '+3.215'} disabled=${row.status !== 'FIN'} onInput=${(e) => setRow(i, { time: e.target.value })} /></td>
              <td class="c"><input class="w-num" type="number" min="0" value=${row.laps_down} disabled=${row.status !== 'FIN'} onInput=${(e) => setRow(i, { laps_down: e.target.value })} /></td>
              <td><input class="w-time mono" value=${row.best_lap} placeholder="1:31.204" onInput=${(e) => setRow(i, { best_lap: e.target.value })} /></td>
              <td class="c"><input type="checkbox" checked=${row.fastest_lap} onChange=${() => setFastest(i)} /></td>
              <td class="c"><input class="w-num" type="number" min="0" value=${row.pit_stops} onInput=${(e) => setRow(i, { pit_stops: e.target.value })} /></td>
              <td class="r pts" title=${p && multiClass ? `P${p.classPos ?? '-'} w klasie` : ''}>${p ? p.points : ''}</td>
              <td class="r actions nowrap">
                <button class="btn btn-xs" onClick=${() => moveTo(i, i - 1)} disabled=${i === 0} title="W górę">↑</button>
                <button class="btn btn-xs" onClick=${() => moveTo(i, i + 1)} disabled=${i === rows.length - 1} title="W dół">↓</button>
                <button class="btn btn-xs btn-danger" onClick=${() => removeRow(i)} title="Usuń wiersz">✕</button>
              </td>
            </tr>`;
          })}
          ${!rows.length ? html`<tr><td colspan=${multiClass ? 13 : 12} class="empty-row">Lista jest pusta — dodaj kierowcę, który zajął <b>P1</b>.</td></tr>` : null}
        </tbody>
      </table>
    </div>
    ${preview.error && rows.some((r) => r.driver_id) ? html`<p class="hint warn">Podgląd: ${preview.error}</p>` : null}

    <div class="add-row">
      <button class="btn btn-accent" onClick=${() => addRow()}>+ Dodaj P${rows.length + 1}</button>
      ${missing.length ? html`<div class="quick-add">
        <span class="muted">albo kliknij kierowcę ze składu rundy ${race.round}, który zajął P${rows.length + 1}:</span>
        ${missing.map((s) => html`<button class="chip" style=${{ '--team': b.teamById.get(s.team_id)?.color || '#888' }} onClick=${() => addRow(s.driver_id)}>${b.driverById.get(s.driver_id)?.nick ?? '?'}</button>`)}
      </div>` : rows.length ? html`<span class="muted">✓ Wpisano wszystkich kierowców ze składu tej rundy</span>` : null}
    </div>

    <div class="form-actions">
      <span class="spacer"></span>
      ${existing.length ? html`<button class="btn btn-danger" onClick=${clearAll}>Usuń wyniki</button>` : null}
      <button class="btn btn-accent" onClick=${save} disabled=${busy}>${busy ? 'Zapisywanie…' : existing.length ? 'Zapisz zmiany' : 'Zapisz wyniki'}</button>
    </div>
  `;
}

/**
 * Import wyników z tekstu — jeden kierowca na linię, w kolejności na mecie:
 *   Nick | Zespół | P. startowa | Pit | Najlepsze okrążenie | Czas [| Klasa]
 */
function PasteImport({ b, seats, onImport }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const parsed = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s*[|\t;]\s*/));
    const norm = (s) => (s || '').trim().toLowerCase();
    const unknown = [...new Set(parsed.map((p) => p[0]).filter((n) => n && !b.drivers.some((d) => norm(d.nick) === norm(n))))];
    if (unknown.length && !confirm(`Nowi kierowcy zostaną dodani do bazy:\n${unknown.join(', ')}\n\nKontynuować?`)) return;
    setBusy(true);
    const created = unknown.length ? await attempt(() => db.insert('drivers', unknown.map((nick) => ({ nick, country_code: 'PL', number: null })))) : [];
    setBusy(false);
    if (created === false) return;
    const all = [...b.drivers, ...(created || [])];
    const CLASS_ALIASES = { HY: 'HY', HYPERCAR: 'HY', LMH: 'HY', LMDH: 'HY', LMP: 'LMP', LMP2: 'LMP', LMP3: 'LMP', GT3: 'GT3', LMGT3: 'GT3' };

    onImport(parsed.map(([nick, team, grid, pit, best, time, cls]) => {
      const d = all.find((x) => norm(x.nick) === norm(nick));
      const t = b.teams.find((x) => norm(x.name) === norm(team));
      const st = (time || '').trim().toUpperCase();
      const status = ['DNF', 'DNS', 'DSQ', 'NC'].includes(st) ? st : 'FIN';
      const lapped = /^\+?(\d+)\s*(okr|lap|l)/i.exec(time || '');
      return {
        ...blankRow(),
        driver_id: d?.id || '',
        team_id: t?.id || seats.get(d?.id)?.team_id || '',
        car_class: CLASS_ALIASES[(cls || '').trim().toUpperCase().replace(/\s/g, '')] || t?.car_class || '',
        grid: (grid || '').replace(/\D/g, ''),
        pit_stops: (pit || '').replace(/\D/g, ''),
        best_lap: best || '',
        status,
        time: status === 'FIN' && !lapped ? (time || '') : '',
        laps_down: lapped ? Number(lapped[1]) : 0,
      };
    }), created || []);
  };

  return html`<div class="subform">
    <b>Wklej wyniki</b>
    <p class="hint">Jedna linia = jeden kierowca, w kolejności na mecie: <code>Nick | ${unit(b.season.series).one} | P. startowa | Pit | Najlepsze okrążenie | Czas</code>${b.season.series !== 'f1' ? html` <code>| Klasa</code>` : null}<br />
      W polu czasu można wpisać <code>DNF</code>, <code>DNS</code>, <code>DSQ</code>, <code>NC</code> albo <code>+1 okr</code>. Działa też wklejka z Excela.</p>
    <textarea rows="8" class="mono" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'Kowal_Racing | McLaren | 2 | 1 | 1:31.204 | 1:28:33.412\nSzybki_Bill | Ferrari | 1 | 1 | 1:31.380 | +3.215'}></textarea>
    <div class="form-actions"><button class="btn btn-accent" onClick=${run} disabled=${busy || !text.trim()}>Wczytaj do formularza</button></div>
  </div>`;
}

// ---------- krok 2: kary ----------

const VALUE_LABEL = { time: 'Sekundy', points: 'Punkty', grid: 'Pozycje' };
const classOrder = (c) => CAR_CLASSES.findIndex((x) => x.id === c);
const byClass = (rows) => rows.sort((x, y) => classOrder(y.carClass) - classOrder(x.carClass));

function RacePenalties({ b, race, reload }) {
  const [f, setF] = useState({ driver_id: '', type: 'time', value: 5, reason: '' });
  const results = b.results.filter((r) => r.race_id === race.id);
  if (!results.length) return html`<div class="empty">Najpierw wpisz wyniki wyścigu (krok 1).</div>`;
  const multiClass = b.season.series !== 'f1';
  const racePens = b.penalties.filter((p) => p.race_id === race.id);
  const before = byClass(computeRaceByClass(race, b.season, b.results, []));
  const after = byClass(computeRaceByClass(race, b.season, b.results, b.penalties));
  const beforeBy = new Map(before.map((r) => [r.driver_id, r]));
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const selected = before.find((r) => r.driver_id === f.driver_id);
  const needsValue = f.type in VALUE_LABEL;

  const add = async (e) => {
    e.preventDefault();
    if (!f.driver_id) return;
    const row = { race_id: race.id, driver_id: f.driver_id, type: f.type, value: needsValue ? Number(f.value) || 0 : 0, reason: f.reason.trim() };
    if (await attempt(() => db.insert('penalties', row), `Nałożono karę: ${nick(f.driver_id)} ${penaltyLabel(row)}`)) {
      setF({ ...f, driver_id: '', reason: '' });
      reload();
    }
  };
  const remove = async (p) => {
    if (!confirm(`Cofnąć karę ${penaltyLabel(p)} dla ${nick(p.driver_id)}?`)) return;
    if (await attempt(() => db.remove('penalties', p.id), 'Kara cofnięta')) reload();
  };

  return html`
    <form class="subform" onSubmit=${add}>
      <b>Nałóż karę</b>
      <div class="form-grid">
        <label class="field"><span>Kierowca</span>
          <select required value=${f.driver_id} onChange=${(e) => setF({ ...f, driver_id: e.target.value })}>
            <option value="">— wybierz —</option>
            ${before.map((r) => html`<option value=${r.driver_id}>${multiClass ? `[${r.carClass}] ` : ''}${r.finalPos ? `P${r.finalPos}` : r.status} · ${nick(r.driver_id)}</option>`)}
          </select>
        </label>
        <label class="field"><span>Rodzaj kary</span>
          <select value=${f.type} onChange=${(e) => setF({ ...f, type: e.target.value })}>
            ${PENALTY_TYPES.map((t) => html`<option value=${t.id}>${t.label}</option>`)}
          </select>
        </label>
        ${needsValue ? html`<label class="field"><span>${VALUE_LABEL[f.type]}</span>
          <input type="number" min="0" step=${f.type === 'time' ? '0.5' : '1'} value=${f.value} onInput=${(e) => setF({ ...f, value: e.target.value })} />
        </label>` : null}
        <label class="field span2"><span>Uzasadnienie (widoczne publicznie)</span>
          <input value=${f.reason} onInput=${(e) => setF({ ...f, reason: e.target.value })} placeholder="np. Spowodowanie kolizji w zakręcie 1" />
        </label>
      </div>
      ${f.type === 'time' && selected && selected.time_ms == null && selected.status === 'FIN' ? html`<p class="hint warn">Ten kierowca nie ma wpisanego czasu — kara czasowa nie zmieni jego pozycji.</p>` : null}
      ${f.type === 'grid' ? html`<p class="hint">Kara na starcie jest informacyjna — uwzględnij ją w polu startowym kolejnego wyścigu.</p>` : null}
      <div class="form-actions"><button class="btn btn-accent">Nałóż karę</button></div>
    </form>

    <h3>Decyzje w tym wyścigu</h3>
    ${!racePens.length ? html`<p class="muted">Brak kar. Ten krok możesz pominąć.</p>` : html`<ul class="pen-list">
      ${racePens.map((p) => html`<li>
        <span class="badge badge-pen">${penaltyLabel(p)}</span>
        <b>${nick(p.driver_id)}</b>
        <span class="muted">${p.reason || '—'}</span>
        <button class="btn btn-xs btn-danger" onClick=${() => remove(p)}>Cofnij</button>
      </li>`)}
    </ul>`}

    <h3>Wynik po karach</h3>
    <div class="table-wrap"><table class="table">
      <thead><tr>${multiClass ? html`<th>Klasa</th>` : null}<th class="c">Poz</th><th class="c">Było</th><th>Kierowca</th><th class="r">Pkt przed</th><th class="r">Pkt po</th></tr></thead>
      <tbody>
        ${after.map((r) => {
          const was = beforeBy.get(r.driver_id);
          const changed = was.finalPos !== r.finalPos || was.points !== r.points;
          return html`<tr class=${changed ? 'row-changed' : ''}>
            ${multiClass ? html`<td>${r.carClass}</td>` : null}
            <td class="c"><${PosBadge} pos=${r.finalPos} status=${r.status} /></td>
            <td class="c muted">${was.finalPos ?? was.status}</td>
            <td>${nick(r.driver_id)} ${r.penalties.map((p) => html`<span class="badge badge-pen">${penaltyLabel(p)}</span>`)}</td>
            <td class="r muted">${was.points}</td>
            <td class="r pts">${r.points}</td>
          </tr>`;
        })}
      </tbody>
    </table></div>
  `;
}

// ---------- krok 3: zmiany w składach po wyścigu ----------

/** Liga LMU: zmiana auta kierowcy od kolejnej rundy (bez limitu miejsc — jednym modelem jedzie dowolnie wielu kierowców). */
function CarChangesAfterRace({ b, race, reload }) {
  const nextRound = race.round + 1;
  const nextRace = b.races.find((r) => r.round === nextRound);
  const now = lineupAt(b.entries, b.rosterChanges, race.round);
  const after = lineupAt(b.entries, b.rosterChanges, nextRound);
  const myChanges = b.rosterChanges.filter((c) => c.from_round === nextRound);
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const carName = (id) => b.teamById.get(id)?.name ?? 'bez auta';
  const classes = seasonClasses(b.season);
  const drivers = [...after.values()].sort((x, y) => nick(x.driver_id).localeCompare(nick(y.driver_id)));

  const change = async (driverId, carId) => {
    const prev = after.get(driverId)?.team_id || null;
    if ((carId || null) === prev) return;
    // zmiana auta = wpis "wchodzi do auta"; zdjęcie z auta = wpis "schodzi z auta"
    const row = carId
      ? { team_id: carId, driver_in_id: driverId, driver_out_id: null }
      : { team_id: prev, driver_in_id: null, driver_out_id: driverId };
    if (await attempt(() => db.insert('roster_changes', { season_id: b.season.id, from_round: nextRound, note: '', ...row }),
      `${nick(driverId)}: ${carName(carId)} od rundy ${nextRound}`)) reload();
  };
  const undo = async (c) => (await attempt(() => db.remove('roster_changes', c.id), 'Zmiana cofnięta')) && reload();

  return html`
    <p class="muted">Zmiany zapisane tutaj obowiązują <b>od rundy ${nextRound}</b>${nextRace ? html` (${b.trackById.get(nextRace.track_id)?.name})` : ' (po ostatnim wyścigu sezonu)'}.
      Wyniki tego i wcześniejszych wyścigów zostają bez zmian.</p>
    ${myChanges.length ? html`<h3>Zmiany po tym wyścigu</h3>
      <ul class="roster-log">
        ${myChanges.map((c) => html`<li>
          <span class="roster-round">od R${c.from_round}</span>
          <span>${c.driver_in_id ? html`<b class="in">${nick(c.driver_in_id)}</b> → ${carName(c.team_id)}` : html`<b class="out">${nick(c.driver_out_id)}</b> → bez auta`}</span>
          <button class="btn btn-xs btn-danger" onClick=${() => undo(c)}>Cofnij</button>
        </li>`)}
      </ul>` : null}
    <h3>Auta na rundę ${nextRound}</h3>
    <div class="table-wrap"><table class="table edit-table">
      <thead><tr><th>Kierowca</th><th>Auto w rundzie ${race.round}</th><th>Auto od rundy ${nextRound}</th></tr></thead>
      <tbody>${drivers.map((s) => html`<tr class=${s.team_id !== (now.get(s.driver_id)?.team_id ?? null) ? 'row-changed' : ''}>
        <td><b>${nick(s.driver_id)}</b></td>
        <td class="muted">${carName(now.get(s.driver_id)?.team_id)}</td>
        <td><select value=${s.team_id || ''} onChange=${(e) => change(s.driver_id, e.target.value)}>
          <option value="">— bez auta —</option>
          ${classes.map((cls) => html`<optgroup label=${carClass(cls)?.label}>${b.teams.filter((x) => x.car_class === cls).map((x) => html`<option value=${x.id}>${x.name}</option>`)}</optgroup>`)}
        </select></td>
      </tr>`)}</tbody>
    </table></div>
  `;
}

function RosterAfterRace({ b, race, reload }) {
  if (b.season.series === 'lmu') return html`<${CarChangesAfterRace} b=${b} race=${race} reload=${reload} />`;
  const nextRound = race.round + 1;
  const nextRace = b.races.find((r) => r.round === nextRound);
  const after = lineupAt(b.entries, b.rosterChanges, nextRound);
  const myChanges = b.rosterChanges.filter((c) => c.from_round === nextRound);
  const [edit, setEdit] = useState(null); // { team_id, out_id | null }
  const [inId, setInId] = useState('');
  const [note, setNote] = useState('');
  const [newReserve, setNewReserve] = useState('');
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const teamName = (id) => b.teamById.get(id)?.name ?? '?';
  const seatsPerTeam = Math.max(1, ...b.teams.map((t) => teamSeats(lineupAt(b.entries, [], 1), t.id).length));

  const record = async (row, msg) => {
    const ok = await attempt(() => db.insert('roster_changes', { season_id: b.season.id, from_round: nextRound, note: note.trim(), ...row }), msg);
    if (ok) {
      setEdit(null);
      setInId('');
      setNote('');
      reload();
    }
  };
  const confirmEdit = () => {
    if (!inId) return;
    record({ team_id: edit.team_id, driver_out_id: edit.out_id || null, driver_in_id: inId },
      edit.out_id ? `${nick(inId)} za ${nick(edit.out_id)} w ${teamName(edit.team_id)} od R${nextRound}` : `${nick(inId)} dołącza do ${teamName(edit.team_id)} od R${nextRound}`);
  };
  const toReserve = (teamId, driverId) => {
    if (!confirm(`${nick(driverId)} schodzi do rezerwy od rundy ${nextRound}? Jego dotychczasowe wyniki zostają.`)) return;
    record({ team_id: teamId, driver_out_id: driverId, driver_in_id: null }, `${nick(driverId)} przechodzi do rezerwy od R${nextRound}`);
  };
  const undo = async (c) => {
    if (await attempt(() => db.remove('roster_changes', c.id), 'Zmiana cofnięta — skład wrócił do poprzedniego stanu')) reload();
  };
  const addReserve = async (e) => {
    e.preventDefault();
    if (!newReserve) return;
    if (await attempt(() => db.insert('entries', { season_id: b.season.id, driver_id: newReserve, team_id: null, is_reserve: true }), 'Dodano do rezerwy')) {
      setNewReserve('');
      reload();
    }
  };

  const reserves = reserveSeats(after);
  const candidates = edit ? [
    ...reserves.map((s) => ({ id: s.driver_id, label: `${nick(s.driver_id)} — rezerwa` })),
    ...[...after.values()].filter((s) => s.team_id && s.team_id !== edit.team_id).map((s) => ({ id: s.driver_id, label: `${nick(s.driver_id)} — transfer z ${teamName(s.team_id)}` })),
  ] : [];
  const outsiders = b.drivers.filter((d) => !after.has(d.id));

  return html`
    <p class="muted">Zmiany zapisane tutaj obowiązują <b>od rundy ${nextRound}</b>${nextRace ? html` (${b.trackById.get(nextRace.track_id)?.name})` : ' (po ostatnim wyścigu sezonu)'}.
      Wyniki tego i wcześniejszych wyścigów zostają bez zmian: punkty zespołu zostają przy zespole, a punkty indywidualne przy kierowcy.</p>

    ${myChanges.length ? html`<h3>Zmiany po tym wyścigu</h3>
      <ul class="roster-log">
        ${myChanges.map((c) => html`<li>
          <span class="roster-round">od R${c.from_round}</span>
          <span><b>${teamName(c.team_id)}</b>:
            ${c.driver_in_id ? html`<b class="in">▲ ${nick(c.driver_in_id)}</b>` : null}
            ${c.driver_in_id && c.driver_out_id ? ' za ' : ''}
            ${c.driver_out_id ? html`<b class="out">▼ ${nick(c.driver_out_id)}</b>${c.driver_in_id ? '' : ' → rezerwa'}` : null}
          </span>
          ${c.note ? html`<span class="muted">${c.note}</span>` : null}
          <button class="btn btn-xs btn-danger" onClick=${() => undo(c)}>Cofnij</button>
        </li>`)}
      </ul>` : null}

    <h3>Skład na rundę ${nextRound}</h3>
    <div class="lineup-grid">
      ${b.teams.map((t) => {
        const ts = teamSeats(after, t.id);
        return html`<div class="lineup-team" style=${{ '--team': t.color || '#888' }}>
          <div class="lineup-team-head"><${TeamLogo} team=${t} size=${28} /> <b>${t.name}</b></div>
          <ul>
            ${ts.map((s) => html`<li>
              <span class="lineup-driver">${myChanges.some((c) => c.driver_in_id === s.driver_id) ? html`<b class="in">▲</b>` : null} ${nick(s.driver_id)}</span>
              <button class="btn btn-xs icon-btn" onClick=${() => { setEdit({ team_id: t.id, out_id: s.driver_id }); setInId(''); }} title="Zamień kierowcę" aria-label="Zamień kierowcę">⇄</button>
              <button class="btn btn-xs icon-btn" onClick=${() => toReserve(t.id, s.driver_id)} title="Przenieś do rezerwy" aria-label="Przenieś do rezerwy">⤓ R</button>
            </li>`)}
          </ul>
          ${ts.length < seatsPerTeam ? html`<button class="btn btn-xs btn-accent" onClick=${() => { setEdit({ team_id: t.id, out_id: null }); setInId(''); }}>+ Wolne miejsce — dodaj kierowcę</button>` : null}
          ${edit?.team_id === t.id ? html`<div class="swap-box">
            <b>${edit.out_id ? `Za: ${nick(edit.out_id)}` : 'Nowy kierowca'}</b>
            <select value=${inId} onChange=${(e) => setInId(e.target.value)}>
              <option value="">— kto wchodzi? —</option>
              ${candidates.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
              ${outsiders.length ? html`<optgroup label="Spoza składu sezonu">${outsiders.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}</optgroup>` : null}
            </select>
            <input placeholder="Powód (opcjonalnie, widoczny publicznie)" value=${note} onInput=${(e) => setNote(e.target.value)} />
            <div class="form-actions">
              <button class="btn btn-sm btn-accent" onClick=${confirmEdit} disabled=${!inId}>Zapisz zmianę</button>
              <button class="btn btn-sm" onClick=${() => setEdit(null)}>Anuluj</button>
            </div>
          </div>` : null}
        </div>`;
      })}
      <div class="lineup-team lineup-reserve">
        <div class="lineup-team-head"><span class="badge badge-reserve">Rezerwa</span> <b>${reserves.length}</b></div>
        <ul>${reserves.map((s) => html`<li><span class="lineup-driver">${myChanges.some((c) => c.driver_out_id === s.driver_id) ? html`<b class="out">▼</b>` : null} ${nick(s.driver_id)}</span></li>`)}</ul>
        <form class="inline-form" onSubmit=${addReserve}>
          <select value=${newReserve} onChange=${(e) => setNewReserve(e.target.value)}>
            <option value="">— dodaj kierowcę do rezerwy —</option>
            ${outsiders.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}
          </select>
          <button class="btn btn-xs" disabled=${!newReserve}>+ Dodaj</button>
        </form>
      </div>
    </div>
  `;
}

// ---------- krok 4: podsumowanie i zatwierdzenie ----------

function RaceSummary({ b, race, nav, reload }) {
  const results = b.results.filter((r) => r.race_id === race.id);
  const pens = b.penalties.filter((p) => p.race_id === race.id);
  const changes = b.rosterChanges.filter((c) => c.from_round === race.round + 1);
  const done = race.status === 'completed';
  const next = b.races.find((r) => r.round === race.round + 1);
  const multiClass = b.season.series !== 'f1';
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';

  const rows = byClass(computeRaceByClass(race, b.season, b.results, b.penalties));
  // klasyfikacja po tej rundzie (ten wyścig liczony tak, jakby był już zatwierdzony)
  const races = b.races.filter((r) => r.round <= race.round).map((r) => (r.id === race.id ? { ...r, status: 'completed' } : r));
  const st = computeStandings({ season: b.season, races, results: b.results, penalties: b.penalties });

  const approve = async () => {
    if (await attempt(() => db.update('races', race.id, { status: 'completed' }), `Runda ${race.round} zatwierdzona i opublikowana`)) {
      reload();
      if (next) nav(next.id, 'wyniki');
    }
  };
  const unapprove = async () => {
    if (!confirm('Cofnąć zatwierdzenie? Wyniki znikną ze strony publicznej do czasu ponownego zatwierdzenia.')) return;
    if (await attempt(() => db.update('races', race.id, { status: 'scheduled' }), 'Zatwierdzenie cofnięte')) reload();
  };

  return html`
    <div class="checklist">
      <div class=${results.length ? 'ok' : 'bad'}>${results.length ? '✓' : '✕'} Wyniki: ${results.length} kierowców</div>
      <div class="ok">⚖️ Kary: ${pens.length || 'brak'}</div>
      <div class="ok">🔁 Zmiany w składzie od R${race.round + 1}: ${changes.length || 'brak'}</div>
    </div>

    ${!results.length ? html`<div class="empty">Bez wyników nie można zatwierdzić wyścigu.</div>` : html`
      <div class="summary-grid">
        <div>
          <h3>Wynik końcowy (po karach)</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr>${multiClass ? html`<th>Kl.</th>` : null}<th class="c">Poz</th><th>Kierowca</th><th>${unit(b.season.series).one}</th><th class="r">Pkt</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr>
              ${multiClass ? html`<td>${r.carClass}</td>` : null}
              <td class="c"><${PosBadge} pos=${r.finalPos} status=${r.status} /></td>
              <td>${nick(r.driver_id)} ${r.penalties.map((p) => html`<span class="badge badge-pen">${penaltyLabel(p)}</span>`)}</td>
              <td><${TeamTag} team=${b.teamById.get(r.team_id)} link=${false} /></td>
              <td class="r pts">${r.points}</td>
            </tr>`)}</tbody>
          </table></div>
        </div>
        <div>
          <h3>Klasyfikacja po rundzie ${race.round}</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th class="c">P</th><th>Kierowca</th><th class="r">Pkt</th></tr></thead>
            <tbody>${st.drivers.slice(0, 10).map((d, i) => html`<tr><td class="c">${i + 1}</td><td>${nick(d.driver_id)}</td><td class="r pts">${d.points}</td></tr>`)}</tbody>
          </table></div>
          <h3>Konstruktorzy</h3>
          <div class="table-wrap"><table class="table">
            <tbody>${st.teams.slice(0, 5).map((t, i) => html`<tr><td class="c">${i + 1}</td><td><${TeamTag} team=${b.teamById.get(t.team_id)} link=${false} /></td><td class="r pts">${t.points}</td></tr>`)}</tbody>
          </table></div>
        </div>
      </div>

      <div class="approve-bar">
        ${done ? html`
          <span class="badge badge-ok">✓ Wyścig zatwierdzony i widoczny na stronie</span>
          <span class="spacer"></span>
          <button class="btn btn-danger" onClick=${unapprove}>Cofnij zatwierdzenie</button>
          ${next ? html`<button class="btn btn-accent" onClick=${() => nav(next.id, 'wyniki')}>Przejdź do rundy ${next.round} →</button>` : null}
        ` : html`
          <span class="muted">Zatwierdzenie publikuje wyniki na stronie i wlicza je do klasyfikacji. Kary i składy możesz zmieniać także później.</span>
          <span class="spacer"></span>
          <button class="btn btn-accent btn-big" onClick=${approve}>✓ Zatwierdź rundę ${race.round}${next ? ` i przejdź do rundy ${next.round}` : ''}</button>
        `}
      </div>
    `}
  `;
}
