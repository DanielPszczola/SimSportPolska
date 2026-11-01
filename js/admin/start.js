import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, seasonUnit, sprintOf, Flag, TeamLogo, attempt, formatDate } from '../ui.js';
import { WEATHER } from '../race-conditions.js';
import { DEFAULT_POINTS, LMU_CLASSES, seasonClasses, seasonStyle, carClass, registerClasses, TEAM_POINTS_MODES, SPRINT_POINTS } from '../scoring.js';
import { categoriesForSeries } from '../tracks-seed.js';
import { F1_TEAMS_2026, LMU_CARS, LOGO_PRESETS, CAR_PRESETS } from '../team-assets.js';
import { StepBar, NextStep, ImageField, ClassSelect, toLocalInput, fromLocalInput, DateTimeInput, TimeInput } from './common.js';

// ---------- kafelek "Start sezonu" ----------

export function StartPanel({ b, seasons, step, nav, reload, checks }) {
  const u = seasonUnit(b.season);
  const lmu = seasonStyle(b.season) === 'lmu';
  const other = b.season.series === 'inne';
  const steps = [
    { id: 'ustawienia', label: 'Ustawienia', note: 'nazwa, punktacja', state: 'done' },
    { id: 'kalendarz', label: 'Kalendarz', note: `${checks.races} wyścigów`, state: checks.races ? 'done' : 'todo' },
    { id: 'zespoly', label: u.many, note: `${checks.teams} ${u.gen}`, state: checks.teams ? 'done' : 'todo' },
    { id: 'sklady', label: u.lineup, note: lmu ? `${checks.regulars} kier. z autem` : `${checks.regulars} etat. · ${checks.reserves} rez.`, state: checks.regulars ? 'done' : 'todo' },
  ];
  const current = steps.some((s) => s.id === step) ? step : steps.find((s) => s.state !== 'done')?.id || 'ustawienia';
  const idx = steps.findIndex((s) => s.id === current);
  const go = (id) => nav('start', id);
  const firstRace = b.races[0];

  return html`<section class="panel">
    <div class="panel-head">
      <div><span class="eyebrow">${other ? 'Konfiguracja wydarzenia' : 'Konfiguracja sezonu'}</span><h2>${other ? 'Start' : 'Start sezonu'} — ${b.season.name}</h2></div>
    </div>
    <${StepBar} steps=${steps} value=${current} onChange=${go} />
    <div class="panel-body">
      ${current === 'ustawienia' ? html`<${SeasonForm} season=${b.season} onSaved=${reload} />` : null}
      ${current === 'kalendarz' ? html`<${CalendarEditor} b=${b} reload=${reload} />` : null}
      ${current === 'zespoly' ? html`<${TeamsEditor} b=${b} seasons=${seasons} reload=${reload} />` : null}
      ${current === 'sklady' ? html`<${StartingLineup} b=${b} reload=${reload} />` : null}
    </div>
    ${idx < steps.length - 1
      ? html`<${NextStep} label=${`Dalej: ${steps[idx + 1].label}`} onClick=${() => go(steps[idx + 1].id)} />`
      : firstRace && checks.ready ? html`<${NextStep} label=${'Konfiguracja gotowa — przejdź do rundy 1'} onClick=${() => nav(firstRace.id, 'wyniki')} />` : null}
  </section>`;
}

export async function deleteSeasonCascade(seasonId) {
  const races = await db.list('races', { eq: { season_id: seasonId } });
  for (const r of races) {
    await db.removeWhere('results', { race_id: r.id });
    await db.removeWhere('penalties', { race_id: r.id });
  }
  await db.removeWhere('races', { season_id: seasonId });
  await db.removeWhere('entries', { season_id: seasonId });
  await db.removeWhere('roster_changes', { season_id: seasonId });
  await db.removeWhere('teams', { season_id: seasonId });
  await db.remove('seasons', seasonId);
}

// ---------- ustawienia sezonu ----------

// kolory kolejnych własnych klas wydarzenia „Inne”
const CLASS_COLORS = ['#f97316', '#3b82f6', '#f5c542', '#22c55e', '#e11d48', '#a855f7', '#14b8a6'];

/**
 * Własne klasy wydarzenia „Inne”: nazwa klasy jest jej identyfikatorem (zapisana przy autach i wynikach),
 * więc zmiana nazwy przepisuje ją też w autach i wynikach wydarzenia; klasy używanej nie da się usunąć.
 */
async function saveClassChanges(seasonId, before, defs) {
  const [teams, races] = await Promise.all([db.list('teams', { eq: { season_id: seasonId } }), db.list('races', { eq: { season_id: seasonId } })]);
  const results = await db.list('results', { in: { race_id: races.map((r) => r.id) } });
  for (const d of defs) {
    if (!d.orig || d.orig === d.id) continue;
    for (const t of teams.filter((x) => x.car_class === d.orig)) await db.update('teams', t.id, { car_class: d.id });
    for (const r of results.filter((x) => x.car_class === d.orig)) await db.update('results', r.id, { car_class: d.id });
  }
  const kept = new Set(defs.map((d) => d.orig).filter(Boolean));
  const removed = before.filter((id) => !kept.has(id));
  const used = removed.filter((id) => teams.some((t) => t.car_class === id) || results.some((r) => r.car_class === id));
  if (used.length) throw new Error(`Klasa ${used.join(', ')} jest używana przez auta lub wyniki — najpierw zmień ich klasę`);
}

/** Edytor własnych klas wydarzenia „Inne” (nazwa + kolor). single = tryb zespołów: jeden typ aut. */
function ClassDefsEditor({ defs, single, onChange }) {
  const set = (i, p) => onChange(defs.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const add = () => onChange([...defs, { id: '', label: '', color: CLASS_COLORS[defs.length % CLASS_COLORS.length], orig: null }]);
  const list = single ? defs.slice(0, 1) : defs;
  return html`<div class="class-defs">
    ${list.map((d, i) => html`<div class="class-def" key=${i}>
      <input type="color" value=${d.color || '#8b8b9e'} onChange=${(e) => set(i, { color: e.target.value })} title="Kolor klasy" />
      <input value=${d.label} maxlength="24" placeholder=${single ? 'np. F2, Porsche Cup' : 'np. GT3, GT4, LMP2'} onInput=${(e) => set(i, { label: e.target.value })} />
      ${!single || defs.length ? html`<button type="button" class="btn btn-sm btn-danger" onClick=${() => onChange(defs.filter((_, j) => j !== i))} title="Usuń">✕</button>` : null}
    </div>`)}
    ${!single || !defs.length ? html`<button type="button" class="btn btn-sm" onClick=${add}>${single ? '+ Podaj typ aut' : '+ Dodaj klasę'}</button>` : null}
  </div>`;
}

export function SeasonForm({ season, onCancel, onSaved }) {
  const isNew = !season.id;
  const series = season.series ?? 'f1';
  const other = series === 'inne';
  const [f, setF] = useState({
    event_format: season.event_format || 'series',
    roster_mode: season.roster_mode || 'teams',
    description: season.description || '',
    class_defs: (season.class_defs || []).map((c) => ({ ...c, label: c.label || c.id, orig: c.id })),
    name: season.name ?? '',
    classes: season.classes?.length ? season.classes : ['HY', 'LMP', 'GT3'],
    team_points: season.team_points || 'final',
    is_current: season.is_current ?? true,
    points: (season.points || DEFAULT_POINTS).join(', '),
    fl_point: season.fl_point ?? (series === 'lmu' ? 0 : 1),
    fl_top10: season.fl_top10 ?? true,
    pole_point: season.pole_point ?? 0,
    finish_bonus: season.finish_bonus ?? 0,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const points = f.points.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (points.some(Number.isNaN)) return alert('Punktacja: podaj liczby oddzielone przecinkami, np. 25, 18, 15');
    if (series === 'lmu' && !f.classes.length) return alert('Wybierz co najmniej jedną klasę sezonu');
    // wydarzenie „Inne”: własne klasy (nazwa = identyfikator), w trybie zespołów najwyżej jeden typ aut
    const defs = (other && f.roster_mode === 'teams' ? f.class_defs.slice(0, 1) : f.class_defs)
      .map((d) => ({ ...d, id: d.label.trim(), label: d.label.trim() })).filter((d) => d.id);
    if (other) {
      if (f.roster_mode === 'cars' && !defs.length) return alert('Dodaj co najmniej jedną klasę aut');
      const names = defs.map((d) => d.id.toLowerCase());
      if (new Set(names).size !== names.length) return alert('Nazwy klas muszą być różne');
    }
    const row = {
      name: f.name.trim(), series, format: 'league', is_current: other ? false : f.is_current, points,
      classes: series === 'lmu' ? LMU_CLASSES.map((c) => c.id).filter((id) => f.classes.includes(id)) : ['HY', 'LMP', 'GT3'],
      team_points: f.team_points,
      fl_point: Number(f.fl_point) || 0, fl_top10: f.fl_top10, pole_point: Number(f.pole_point) || 0, finish_bonus: Number(f.finish_bonus) || 0,
      // kolumny wydarzeń „Inne” wysyłamy tylko dla nich (sezony F1/LMU działają też bez aktualizacji bazy)
      ...(other ? {
        event_format: f.event_format, roster_mode: f.roster_mode, description: f.description.trim(),
        class_defs: defs.map(({ id, label, color }) => ({ id, label, color })),
      } : {}),
    };
    const saved = await attempt(async () => {
      if (other && !isNew) await saveClassChanges(season.id, (season.class_defs || []).map((c) => c.id), defs);
      const s = isNew ? await db.insert('seasons', row) : await db.update('seasons', season.id, row);
      if (other) registerClasses(row.class_defs);
      if (row.is_current) {
        const others = await db.list('seasons', { eq: { series, is_current: true } });
        for (const o of others) if (o.id !== s.id) await db.update('seasons', o.id, { is_current: false });
      }
      return s;
    }, isNew ? `${other ? 'Wydarzenie utworzone' : 'Sezon utworzony'} — teraz ułóż kalendarz` : 'Zapisano ustawienia');
    if (!saved) return;
    // zapisane nazwy klas są od teraz punktem odniesienia przy kolejnej zmianie (formularz zostaje otwarty)
    if (other) setF((x) => ({ ...x, class_defs: defs.map((d) => ({ ...d, orig: d.id })) }));
    onSaved(saved);
  };

  return html`<form onSubmit=${submit}>
    <h3>${isNew ? (other ? 'Nowe wydarzenie lub seria' : `Nowy sezon — ${series === 'f1' ? 'Formuła 1' : 'Le Mans Ultimate'}`) : (other ? 'Ustawienia wydarzenia' : 'Ustawienia sezonu')}</h3>
    <div class="form-grid">
      <label class="field span2"><span>Nazwa</span><input required value=${f.name} onInput=${set('name')} placeholder=${other ? 'np. Puchar F2 2027, Charytatywne 2h Spa' : 'np. Sezon 3 — 2027'} /></label>
      ${other ? html`
        <label class="field span2"><span>Krótki opis (opcjonalnie)</span><textarea rows="2" value=${f.description} onInput=${set('description')} placeholder="np. 4 rundy, start w listopadzie — wyświetlany na liście wydarzeń"></textarea></label>
        <div class="field span2"><span>Format</span>
          <label class="radio-line"><input type="radio" name="event_format" checked=${f.event_format === 'series'} onChange=${() => setF({ ...f, event_format: 'series' })} />
            <span><b>Seria</b> — kilka wyścigów z klasyfikacją, jak sezon ligi</span></label>
          <label class="radio-line"><input type="radio" name="event_format" checked=${f.event_format === 'single'} onChange=${() => setF({ ...f, event_format: 'single' })} />
            <span><b>Pojedyncze wydarzenie</b> — jeden wyścig (opcjonalnie ze sprintem), bez klasyfikacji</span></label>
        </div>
        <div class="field span2"><span>Składy</span>
          <label class="radio-line"><input type="radio" name="roster_mode" checked=${f.roster_mode === 'teams'} onChange=${() => setF({ ...f, roster_mode: 'teams' })} />
            <span><b>Zespoły</b> — jak w F1: zespoły kierowców, jeden typ aut, klasyfikacja zespołów</span></label>
          <label class="radio-line"><input type="radio" name="roster_mode" checked=${f.roster_mode === 'cars'} onChange=${() => setF({ ...f, roster_mode: 'cars' })} />
            <span><b>Auta i klasy</b> — jak w lidze LMU: kierowcy przypisani do aut, wyniki osobno w każdej klasie</span></label>
          ${!isNew && f.roster_mode !== (season.roster_mode || 'teams') ? html`<small class="hint warn">Zmiana trybu po dodaniu zespołów lub wyników może wymagać poprawienia składów.</small>` : null}
        </div>
        <div class="field span2"><span>${f.roster_mode === 'cars' ? 'Klasy aut (własne nazwy)' : 'Typ aut (opcjonalnie)'}</span>
          <${ClassDefsEditor} defs=${f.class_defs} single=${f.roster_mode === 'teams'} onChange=${(class_defs) => setF({ ...f, class_defs })} />
          <small class="muted">${f.roster_mode === 'cars'
            ? 'Każde auto ma jedną z tych klas. Wyniki i klasyfikacje liczone są osobno w każdej klasie.'
            : 'Np. F2 — wyświetlany przy wydarzeniu i w wynikach.'}</small>
        </div>` : null}
      ${series === 'lmu' ? html`<div class="field span2"><span>Klasy jadące w sezonie (1–3)</span>
        <div class="class-checks">
          ${LMU_CLASSES.map((c) => html`<label class="class-check" style=${{ '--cls': c.color }}>
            <input type="checkbox" checked=${f.classes.includes(c.id)}
              onChange=${(e) => setF({ ...f, classes: e.target.checked ? [...f.classes, c.id] : f.classes.filter((x) => x !== c.id) })} /> ${c.label}
          </label>`)}
        </div>
        <small class="muted">Wyniki i klasyfikacje są liczone osobno dla każdej klasy.</small>
      </div>` : null}
      ${series === 'f1' || (other && f.roster_mode === 'teams') ? html`<div class="field span2"><span>Punkty ${other ? 'zespołów' : 'konstruktorów'}</span>
        ${TEAM_POINTS_MODES.map((m) => html`<label class="radio-line"><input type="radio" name="team_points" checked=${f.team_points === m.id} onChange=${() => setF({ ...f, team_points: m.id })} />
          <span><b>${m.label}</b> — ${m.desc}</span></label>`)}
      </div>` : null}
      <label class="field span2"><span>Punkty za pozycje (od 1. miejsca)</span><input value=${f.points} onInput=${set('points')} /></label>
      <label class="field"><span>Pkt za najszybsze okrążenie</span><input type="number" min="0" value=${f.fl_point} onInput=${set('fl_point')} /></label>
      <label class="field"><span>Pkt za pole position</span><input type="number" min="0" value=${f.pole_point} onInput=${set('pole_point')} /></label>
      <label class="field"><span>Bonus za ukończenie wyścigu</span><input type="number" min="0" value=${f.finish_bonus} onInput=${set('finish_bonus')} /></label>
      <div class="field checks">
        <label><input type="checkbox" checked=${f.fl_top10} onChange=${set('fl_top10')} /> NO punktowane tylko w TOP 10</label>
        ${!other ? html`<label><input type="checkbox" checked=${f.is_current} onChange=${set('is_current')} /> Bieżący sezon (domyślny na stronie)</label>` : null}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-accent">${isNew ? (other ? 'Utwórz wydarzenie' : 'Utwórz sezon') : 'Zapisz ustawienia'}</button>
      ${onCancel ? html`<button type="button" class="btn" onClick=${onCancel}>Anuluj</button>` : null}
    </div>
  </form>`;
}

// ---------- kalendarz ----------

function CalendarEditor({ b, reload }) {
  const season = b.season;
  const [add, setAdd] = useState({ track_id: '', race_date: '', laps: '', weather: '', game_time: '', sprint: false, sprint_date: '' });
  const races = b.races; // wyścigi główne — sprint (weekend sprinterski) ma ten sam numer rundy
  // pogoda i pora dnia w grze oraz sprinty — liga LMU i wydarzenia „Inne” (ustawienia serwera, niezależne od terminu zawodów)
  const lmu = season.series !== 'f1';
  const single = season.event_format === 'single'; // pojedyncze wydarzenie: jeden wyścig
  const weatherOptions = () => html`<option value="">— nie ustalono —</option>
    ${WEATHER.map((w) => html`<option value=${w.id}>${w.icon} ${w.label}</option>`)}`;
  // tylko tory z kategorii tej serii (F1 -> F1, LMU -> Hypercar / LMP / GT3), pogrupowane wg kategorii
  const cats = categoriesForSeries(season.series);
  const trackOptions = () => cats.map((c) => html`<optgroup label=${c.label}>
    ${b.tracks.filter((t) => t.category === c.id)
      .map((t) => html`<option value=${t.id}>${t.name}${cats.length > 1 ? ` · ${c.label}` : ''}</option>`)}
  </optgroup>`);

  const addRace = async (e) => {
    e.preventDefault();
    if (!add.track_id) return;
    const round = races.reduce((m, r) => Math.max(m, r.round), 0) + 1;
    const base = {
      season_id: season.id, round, track_id: add.track_id, status: 'scheduled', counts: true, notes: '',
      ...(lmu ? { weather: add.weather || null, game_time: add.game_time || null } : {}),
    };
    const ok = await attempt(async () => {
      await db.insert('races', { ...base, race_date: fromLocalInput(add.race_date), laps: add.laps ? Number(add.laps) : null });
      if (lmu && add.sprint) await db.insert('races', { ...base, kind: 'sprint', race_date: fromLocalInput(add.sprint_date || add.race_date), laps: null });
    }, `Dodano rundę ${round}${lmu && add.sprint ? ' (weekend sprinterski)' : ''}`);
    if (ok) {
      setAdd({ ...add, track_id: '', laps: '', weather: '', game_time: '', sprint: false, sprint_date: '' });
      reload();
    }
  };
  const patch = async (race, p) => (await attempt(() => db.update('races', race.id, p))) && reload();
  // tor i „do klasyfikacji” są wspólne dla całego weekendu — zmiana obejmuje też sprint
  const patchRound = async (race, p) => {
    const sprint = sprintOf(b, race);
    const ok = await attempt(async () => {
      await db.update('races', race.id, p);
      if (sprint) await db.update('races', sprint.id, p);
    });
    if (ok) reload();
  };
  const move = async (i, dir) => {
    const a = races[i];
    const c = races[i + dir];
    if (!c) return;
    const sa = sprintOf(b, a);
    const sc = sprintOf(b, c);
    await attempt(async () => {
      await db.update('races', a.id, { round: c.round });
      await db.update('races', c.id, { round: a.round });
      if (sa) await db.update('races', sa.id, { round: c.round });
      if (sc) await db.update('races', sc.id, { round: a.round });
    });
    reload();
  };
  const dropSession = async (race) => {
    await db.removeWhere('results', { race_id: race.id });
    await db.removeWhere('penalties', { race_id: race.id });
    await db.remove('races', race.id);
  };
  const remove = async (race) => {
    const t = b.trackById.get(race.track_id);
    const sprint = sprintOf(b, race);
    if (!confirm(`Usunąć rundę ${race.round} (${t?.name})${sprint ? ' razem ze sprintem' : ''} wraz z wynikami i karami?`)) return;
    const ok = await attempt(async () => {
      if (sprint) await dropSession(sprint);
      await dropSession(race);
    }, 'Runda usunięta');
    if (ok) reload();
  };
  // weekend sprinterski: włączenie dodaje sprint (ta sama runda i tor), wyłączenie go usuwa
  const toggleSprint = async (race, on) => {
    const sprint = sprintOf(b, race);
    if (on && !sprint) {
      const ok = await attempt(() => db.insert('races', {
        season_id: season.id, round: race.round, track_id: race.track_id, kind: 'sprint', race_date: race.race_date,
        laps: null, status: 'scheduled', counts: race.counts !== false, notes: '', weather: race.weather || null, game_time: race.game_time || null,
      }), `Runda ${race.round}: dodano sprint — ustaw jego datę i godzinę`);
      if (ok) reload();
    } else if (!on && sprint) {
      const hasResults = b.results.some((r) => r.race_id === sprint.id);
      if (!confirm(`Usunąć sprint z rundy ${race.round}${hasResults ? ' wraz z jego wynikami i karami' : ''}?`)) return reload();
      if (await attempt(() => dropSession(sprint), 'Sprint usunięty')) reload();
    }
  };
  const statusBadge = (r) => (r.status === 'completed' ? html`<span class="badge badge-ok">Zatwierdzony</span>` : html`<span class="badge">Zaplanowany</span>`);
  const weatherCells = (r) => html`
    <td><select value=${r.weather || ''} onChange=${(e) => patch(r, { weather: e.target.value || null })}>${weatherOptions()}</select></td>
    <td><${TimeInput} allowEmpty value=${r.game_time} onChange=${(v) => patch(r, { game_time: v || null })} /></td>`;

  return html`
    <h3>Kalendarz — ${races.length} ${races.length === 1 ? 'wyścig' : 'wyścigów'}</h3>
    ${single && races.length ? html`<p class="hint">Pojedyncze wydarzenie ma jeden wyścig — tor, termin i sprint ustawisz w tabeli poniżej.</p>` : html`<form class="subform add-race" onSubmit=${addRace}>
      <div class="form-grid">
        <label class="field span2"><span>Tor</span>
          <select required value=${add.track_id} onChange=${(e) => setAdd({ ...add, track_id: e.target.value })}>
            <option value="">— wybierz tor z bazy —</option>
            ${trackOptions()}
          </select>
        </label>
        <label class="field"><span>Data i godzina</span><${DateTimeInput} value=${add.race_date} onChange=${(v) => setAdd({ ...add, race_date: v })} /></label>
        <label class="field"><span>Okrążenia</span><input type="number" min="1" value=${add.laps} onInput=${(e) => setAdd({ ...add, laps: e.target.value })} /></label>
        ${lmu ? html`
          <label class="field"><span>Pogoda w grze</span>
            <select value=${add.weather} onChange=${(e) => setAdd({ ...add, weather: e.target.value })}>${weatherOptions()}</select>
          </label>
          <label class="field"><span>Pora dnia w grze (godzina startu)</span><${TimeInput} allowEmpty value=${add.game_time} onChange=${(v) => setAdd({ ...add, game_time: v })} /></label>
          <p class="hint span2">Pogoda i pora dnia to ustawienia wyścigu w grze — nie mają związku z datą i godziną zawodów.</p>
          <label class="check-inline span2"><input type="checkbox" checked=${add.sprint} onChange=${(e) => setAdd({ ...add, sprint: e.target.checked })} />
            Weekend sprinterski — oprócz wyścigu głównego jest sprint (punkty ${SPRINT_POINTS.join('-')} jak w F1)</label>
          ${add.sprint ? html`<label class="field"><span>Data i godzina sprintu</span><${DateTimeInput} value=${add.sprint_date} onChange=${(v) => setAdd({ ...add, sprint_date: v })} /></label>` : null}` : null}
      </div>
      <div class="form-actions">
        <button class="btn btn-accent">${single ? '+ Dodaj wyścig' : '+ Dodaj rundę'}</button>
        <a href="#/admin/baza/tory" class="muted">Brakuje toru? Dodaj go w Bazie danych →</a>
      </div>
    </form>`}

    ${!races.length ? html`<p class="muted">Kalendarz jest pusty.</p>` : html`<div class="table-wrap"><table class="table edit-table">
      <thead><tr><th class="c">Runda</th><th>Tor</th><th>Data</th><th class="c">Okr.</th>${lmu ? html`<th title="Ustawienie w grze">Pogoda (gra)</th><th title="Godzina startu w grze">Pora dnia (gra)</th><th class="c" title="Weekend sprinterski: sprint + wyścig główny">Sprint</th>` : null}<th class="c" title="Liczy się do klasyfikacji">Do klasyf.</th><th>Status</th><th class="r"></th></tr></thead>
      <tbody>
        ${races.map((r, i) => {
          const sprint = sprintOf(b, r);
          return html`${sprint ? html`<tr key=${sprint.id} class="sprint-row">
          <td class="c"><span class="badge badge-sprint">Sprint</span></td>
          <td class="muted small">tor jak w wyścigu głównym · punkty ${SPRINT_POINTS.join('-')}</td>
          <td><${DateTimeInput} value=${toLocalInput(sprint.race_date)} onChange=${(v) => patch(sprint, { race_date: fromLocalInput(v) })} title=${formatDate(sprint.race_date)} /></td>
          <td class="c"><input class="w-num" type="number" min="1" value=${sprint.laps ?? ''} onChange=${(e) => patch(sprint, { laps: e.target.value ? Number(e.target.value) : null })} /></td>
          ${weatherCells(sprint)}
          <td></td><td></td>
          <td>${statusBadge(sprint)}</td>
          <td></td>
        </tr>` : null}
        <tr key=${r.id}>
          <td class="c"><b>${r.round}</b></td>
          <td class="nowrap"><${Flag} code=${b.trackById.get(r.track_id)?.country_code} />
            <select value=${r.track_id} onChange=${(e) => patchRound(r, { track_id: e.target.value })}>
              ${trackOptions()}
            </select>
          </td>
          <td><${DateTimeInput} value=${toLocalInput(r.race_date)} onChange=${(v) => patch(r, { race_date: fromLocalInput(v) })} title=${formatDate(r.race_date)} /></td>
          <td class="c"><input class="w-num" type="number" min="1" value=${r.laps ?? ''} onChange=${(e) => patch(r, { laps: e.target.value ? Number(e.target.value) : null })} /></td>
          ${lmu ? html`${weatherCells(r)}
            <td class="c"><input type="checkbox" checked=${!!sprint} onChange=${(e) => toggleSprint(r, e.target.checked)} title="Weekend sprinterski" /></td>` : null}
          <td class="c"><input type="checkbox" checked=${r.counts !== false} onChange=${(e) => patchRound(r, { counts: e.target.checked })} /></td>
          <td>${statusBadge(r)}</td>
          <td class="r actions">
            <button class="btn btn-sm" disabled=${i === 0} onClick=${() => move(i, -1)} title="W górę">↑</button>
            <button class="btn btn-sm" disabled=${i === races.length - 1} onClick=${() => move(i, 1)} title="W dół">↓</button>
            <button class="btn btn-sm btn-danger" onClick=${() => remove(r)}>Usuń</button>
          </td>
        </tr>`;
        })}
      </tbody>
    </table></div>`}
  `;
}

// ---------- zespoły (F1) / samochody (liga LMU) ----------
// W bazie to ta sama tabela (teams). W lidze LMU rekord oznacza samochód: marka i model, klasa, logo marki, zdjęcie auta.

const emptyTeam = () => ({ name: '', color: '#7c3aed', logo_url: null, car_url: null, car_class: null });

const TEXT = {
  f1: {
    nameLabel: 'Nazwa zespołu w tym sezonie', namePh: 'np. Scuderia Ferrari HP', logo: 'Logo', image: 'Profil bolidu',
    title: 'Zespoły', add: '+ Dodaj zespół', addTitle: 'Nowy zespół', save: 'Zapisz zespół', remove: 'Usuń zespół',
    intro: 'Zespoły tworzysz osobno dla każdego sezonu: nazwa, kolor, logo i profil bolidu obowiązują tylko w tym sezonie. Wyniki z poprzednich sezonów zachowują nazwy i barwy z tamtego czasu.',
    copy: '— skopiuj zespoły i składy z sezonu… —', copied: 'Skopiowano zespoły i składy — zmień nazwy i grafiki na nowy sezon',
  },
  lmu: {
    nameLabel: 'Marka i model auta', namePh: 'np. BMW M Hybrid V8', logo: 'Logo marki', image: 'Zdjęcie auta',
    title: 'Samochody', add: '+ Dodaj samochód', addTitle: 'Nowy samochód', save: 'Zapisz samochód', remove: 'Usuń samochód',
    intro: 'W lidze LMU liczy się auto, którym jedzie kierowca, a nie zespół. Dodaj modele aut jeżdżące w tym sezonie, a w kroku „Przypisanie aut” przypisz kierowcom auta. Jednym modelem może jechać dowolnie wielu kierowców.',
    copy: '— skopiuj auta i przypisania z sezonu… —', copied: 'Skopiowano auta i przypisania kierowców',
  },
};

/** Formularz jednego zespołu / samochodu — ten sam przy dodawaniu i edycji. */
function TeamForm({ team, multiClass, classOptions, onChange, t }) {
  const set = (k) => (v) => onChange({ [k]: v });
  return html`<div class="team-form">
    <div class="team-form-main">
      <label class="field"><span>${t.nameLabel}</span>
        <input required value=${team.name} placeholder=${t.namePh} onChange=${(e) => set('name')(e.target.value.trim())} />
      </label>
      <div class="team-form-row">
        <label class="field"><span>Kolor</span>
          <span class="color-field"><input type="color" value=${team.color || '#888888'} onChange=${(e) => set('color')(e.target.value)} /><code>${team.color}</code></span>
        </label>
        ${multiClass ? html`<label class="field"><span>Klasa</span><${ClassSelect} value=${team.car_class} options=${classOptions} onChange=${set('car_class')} /></label>` : null}
      </div>
    </div>
    <div class="field"><span>${t.logo}</span><${ImageField} kind="logo" value=${team.logo_url} presets=${multiClass ? [] : LOGO_PRESETS} onChange=${set('logo_url')} /></div>
    <div class="field team-form-car"><span>${t.image}</span><${ImageField} kind="car" value=${team.car_url} presets=${multiClass ? [] : CAR_PRESETS} onChange=${set('car_url')} /></div>
  </div>`;
}

// wydarzenia „Inne”: bez nawiązań do ligi F1 / LMU
const INTRO_OTHER = {
  f1: 'Zespoły tego wydarzenia: nazwa, kolor, logo i profil bolidu. W kolejnym kroku przypisz do nich kierowców.',
  lmu: 'Dodaj auta jeżdżące w tym wydarzeniu i przypisz każdemu klasę. W kolejnym kroku przypisz kierowcom auta — jednym autem może jechać dowolnie wielu kierowców.',
};

function TeamsEditor({ b, seasons, reload }) {
  const season = b.season;
  const lmu = seasonStyle(season) === 'lmu';
  const t = season.series === 'inne'
    ? { ...TEXT[lmu ? 'lmu' : 'f1'], intro: INTRO_OTHER[lmu ? 'lmu' : 'f1'], copy: `— skopiuj ${lmu ? 'auta' : 'zespoły'} i składy z wydarzenia… —` }
    : TEXT[lmu ? 'lmu' : 'f1'];
  const multiClass = lmu;
  const classOptions = seasonClasses(season);
  const [draft, setDraft] = useState(null);
  const [copyFrom, setCopyFrom] = useState('');
  const others = seasons.filter((s) => s.id !== season.id);
  // podpowiedź modeli z Le Mans Ultimate (tylko klasy jadące w sezonie, bez aut już dodanych)
  const carPresets = season.series === 'lmu' ? LMU_CARS.filter((c) => classOptions.includes(c.car_class) && !b.teams.some((x) => x.name === c.name)) : [];

  const insertTeams = async (rows, msg) => (await attempt(() => db.insert('teams', rows.map((r) => ({ season_id: season.id, ...r }))), msg)) && reload();
  const saveDraft = async () => {
    if (!draft.name?.trim()) return alert(lmu ? 'Podaj markę i model auta' : 'Podaj nazwę zespołu');
    if (multiClass && !draft.car_class) return alert('Wybierz klasę samochodu');
    if (await attempt(() => db.insert('teams', { season_id: season.id, ...draft, name: draft.name.trim() }), `Dodano: ${draft.name}`)) {
      setDraft(null);
      reload();
    }
  };
  const useF1Template = () => {
    if (!confirm(`Dodać ${F1_TEAMS_2026.length} zespołów F1 2026 z gotowymi grafikami? Każdy możesz potem zmienić.`)) return;
    insertTeams(F1_TEAMS_2026.map(({ name, color, logo_url, car_url }) => ({ name, color, logo_url, car_url, car_class: null })), 'Dodano zespoły F1 2026');
  };
  const pickPreset = (name) => {
    const c = LMU_CARS.find((x) => x.name === name);
    if (c) setDraft({ ...emptyTeam(), name: c.name, color: c.color, car_class: c.car_class });
  };
  const copy = async () => {
    if (!copyFrom) return;
    const ok = await attempt(async () => {
      const [srcTeams, srcEntries] = await Promise.all([
        db.list('teams', { eq: { season_id: copyFrom } }),
        db.list('entries', { eq: { season_id: copyFrom } }),
      ]);
      const created = await db.insert('teams', srcTeams.map((x) => ({
        season_id: season.id, name: x.name, color: x.color, logo_url: x.logo_url, car_url: x.car_url ?? null, car_class: multiClass ? x.car_class ?? null : null,
      })));
      const map = new Map(srcTeams.map((x, i) => [x.id, created[i].id]));
      const existing = new Set(b.entries.map((e) => e.driver_id));
      await db.insert('entries', srcEntries.filter((e) => !existing.has(e.driver_id)).map((e) => ({
        season_id: season.id, driver_id: e.driver_id, team_id: map.get(e.team_id) ?? null, is_reserve: e.is_reserve,
      })));
    }, t.copied);
    if (ok) reload();
  };
  const patchTeam = async (x, p) => (await attempt(() => db.update('teams', x.id, p))) && reload();
  const removeTeam = async (x) => {
    if (!confirm(`Usunąć ${x.name}? Wyniki kierowców zostaną, ale bez przypisania.`)) return;
    const ok = await attempt(async () => {
      for (const en of b.entries.filter((e) => e.team_id === x.id)) await db.update('entries', en.id, { team_id: null, is_reserve: true });
      await db.removeWhere('roster_changes', { team_id: x.id });
      await db.remove('teams', x.id);
    }, 'Usunięto');
    if (ok) reload();
  };

  return html`
    <h3>${t.title} — ${b.teams.length}</h3>
    <p class="muted">${t.intro}</p>

    ${!b.teams.length && (season.series === 'f1' || others.length) ? html`<div class="subform">
      <b>Szybki start</b> <span class="muted">(opcjonalnie)</span>
      <div class="form-actions">
        ${season.series === 'f1' ? html`<button class="btn" onClick=${useF1Template}>Szablon: 11 zespołów F1 2026</button>` : null}
        ${others.length ? html`
          <select value=${copyFrom} onChange=${(e) => setCopyFrom(e.target.value)}>
            <option value="">${t.copy}</option>
            ${others.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select>
          <button class="btn" onClick=${copy} disabled=${!copyFrom}>Kopiuj</button>` : null}
      </div>
    </div>` : null}

    <div class="team-edit-list">
      ${b.teams.map((x) => html`<div class="team-edit" key=${x.id} style=${{ '--team': x.color || '#888' }}>
        <${TeamForm} team=${x} t=${t} multiClass=${multiClass} classOptions=${classOptions} onChange=${(p) => patchTeam(x, p)} />
        <div class="team-edit-actions">
          ${lmu ? html`<span class="muted small">${b.entries.filter((e) => e.team_id === x.id && !e.is_reserve).length} kierowców</span>` : null}
          <button class="btn btn-sm btn-danger" onClick=${() => removeTeam(x)}>${t.remove}</button>
        </div>
      </div>`)}
    </div>

    ${draft ? html`<div class="team-edit team-draft" style=${{ '--team': draft.color || '#888' }}>
      <div class="team-draft-head"><b>${t.addTitle}</b></div>
      <${TeamForm} team=${draft} t=${t} multiClass=${multiClass} classOptions=${classOptions} onChange=${(p) => setDraft({ ...draft, ...p })} />
      <div class="form-actions">
        <button class="btn btn-accent" onClick=${saveDraft}>${t.save}</button>
        <button class="btn" onClick=${() => setDraft(null)}>Anuluj</button>
      </div>
    </div>` : html`<div class="form-actions">
      ${lmu && carPresets.length ? html`<select value="" onChange=${(e) => pickPreset(e.target.value)} title="Modele aut z Le Mans Ultimate">
        <option value="">+ Dodaj model z Le Mans Ultimate…</option>
        ${classOptions.map((cls) => html`<optgroup label=${carClass(cls)?.label}>
          ${carPresets.filter((c) => c.car_class === cls).map((c) => html`<option value=${c.name}>${c.name}</option>`)}
        </optgroup>`)}
      </select>` : null}
      <button class=${`btn ${carPresets.length ? '' : 'btn-accent'}`} onClick=${() => setDraft({ ...emptyTeam(), car_class: classOptions.length === 1 ? classOptions[0] : null })}>${carPresets.length ? '+ Inne auto (wpisz ręcznie)' : t.add}</button>
    </div>`}
  `;
}

// ---------- składy startowe (F1) / przypisanie aut (liga LMU) ----------

function StartingLineup({ b, reload }) {
  const lmu = seasonStyle(b.season) === 'lmu';
  const [add, setAdd] = useState({ driver_id: '', team_id: '' });
  const free = b.drivers.filter((d) => !b.entries.some((e) => e.driver_id === d.id));
  const nick = (id) => b.driverById.get(id);
  const reserves = b.entries.filter((e) => e.is_reserve || !e.team_id);
  const none = lmu ? 'Bez auta' : 'Rezerwa';

  const addEntry = async (e) => {
    e.preventDefault();
    if (!add.driver_id) return;
    const row = { season_id: b.season.id, driver_id: add.driver_id, team_id: add.team_id || null, is_reserve: !add.team_id };
    if (await attempt(() => db.insert('entries', row), add.team_id ? (lmu ? 'Przypisano auto' : 'Dodano do zespołu') : 'Dodano do rezerwy')) {
      setAdd({ ...add, driver_id: '' });
      reload();
    }
  };
  const setTeam = async (en, teamId) => (await attempt(() => db.update('entries', en.id, { team_id: teamId || null, is_reserve: !teamId }))) && reload();
  const removeEntry = async (en) => {
    if (!confirm(`Usunąć ${nick(en.driver_id)?.nick} z sezonu? Jego wyniki zostaną.`)) return;
    if (await attempt(() => db.remove('entries', en.id))) reload();
  };
  const teamOptions = () => (lmu
    ? seasonClasses(b.season).map((cls) => html`<optgroup label=${carClass(cls)?.label}>${b.teams.filter((x) => x.car_class === cls).map((x) => html`<option value=${x.id}>${x.name}</option>`)}</optgroup>`)
    : b.teams.map((x) => html`<option value=${x.id}>${x.name}</option>`));

  const driverRow = (en) => html`<li key=${en.id}>
    <span class="lineup-driver"><${Flag} code=${nick(en.driver_id)?.country_code} size=${16} /> <span class="num">${nick(en.driver_id)?.number ?? ''}</span> ${nick(en.driver_id)?.nick ?? '?'}</span>
    <select value=${en.is_reserve ? '' : en.team_id || ''} onChange=${(e) => setTeam(en, e.target.value)} title=${lmu ? 'Zmień auto' : 'Przenieś'}>
      <option value="">${none}</option>
      ${teamOptions()}
    </select>
    <button class="btn btn-xs btn-danger" onClick=${() => removeEntry(en)} title="Usuń z sezonu">✕</button>
  </li>`;

  return html`
    <h3>${lmu ? 'Przypisanie aut' : 'Składy'}${b.season.event_format === 'single' ? '' : ' na start sezonu (runda 1)'}</h3>
    <p class="muted">${lmu
      ? 'Przypisz każdemu kierowcy auto, którym jedzie. Zmiana auta w trakcie sezonu: kafelek „Składy” na osi sezonu (obowiązuje od wybranej rundy, wcześniejsze wyniki zostają).'
      : 'To skład, z którym zaczyna się sezon. Zmiany w trakcie sezonu (także między wyścigami) wprowadzasz w kafelkach „Składy” między wyścigami na osi sezonu. Obowiązują od rundy, przed którą stoi kafelek, a wcześniejsze wyniki zostają nietknięte.'}</p>
    ${b.rosterChanges.length ? html`<p class="hint warn">W sezonie zapisano już ${b.rosterChanges.length} zmian. Zmiana na starcie wpływa na wszystkie rundy przed pierwszą zmianą.</p>` : null}
    ${lmu && !b.teams.length ? html`<p class="hint warn">Najpierw dodaj samochody w poprzednim kroku.</p>` : null}
    <div class="lineup-grid">
      ${b.teams.map((x) => html`<div class="lineup-team" style=${{ '--team': x.color || '#888' }}>
        <div class="lineup-team-head"><${TeamLogo} team=${x} size=${28} /> <b>${x.name}</b>
          ${lmu && x.car_class ? html`<span class="class-badge" style=${{ '--cls': carClass(x.car_class)?.color }}>${carClass(x.car_class)?.label ?? x.car_class}</span>` : null}</div>
        <ul>${b.entries.filter((e) => !e.is_reserve && e.team_id === x.id).map(driverRow)}</ul>
        ${b.entries.filter((e) => !e.is_reserve && e.team_id === x.id).length === 0 ? html`<p class="muted small">Brak kierowców</p>` : null}
      </div>`)}
      <div class="lineup-team lineup-reserve">
        <div class="lineup-team-head"><span class="badge badge-reserve">${none}</span> <b>${reserves.length} kierowców</b></div>
        <ul>${reserves.map(driverRow)}</ul>
      </div>
    </div>
    <form class="inline-form" onSubmit=${addEntry}>
      <select required value=${add.driver_id} onChange=${(e) => setAdd({ ...add, driver_id: e.target.value })}>
        <option value="">— kierowca z bazy —</option>
        ${free.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}
      </select>
      <select value=${add.team_id} onChange=${(e) => setAdd({ ...add, team_id: e.target.value })}>
        <option value="">${none}</option>
        ${teamOptions()}
      </select>
      <button class="btn btn-accent">${lmu ? '+ Dodaj kierowcę' : '+ Dodaj do składu'}</button>
      <a class="muted" href="#/admin/baza/kierowcy">Nowy kierowca? Dodaj go w Bazie danych →</a>
    </form>
  `;
}
