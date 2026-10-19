import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, unit, Flag, TeamLogo, attempt, formatDate } from '../ui.js';
import { DEFAULT_POINTS, LMU_CLASSES, seasonClasses, carClass, TEAM_POINTS_MODES } from '../scoring.js';
import { categoriesForSeries } from '../tracks-seed.js';
import { F1_TEAMS_2026, LMU_CARS, LOGO_PRESETS, CAR_PRESETS } from '../team-assets.js';
import { StepBar, NextStep, ImageField, ClassSelect, toLocalInput, fromLocalInput } from './common.js';

// ---------- kafelek "Start sezonu" ----------

export function StartPanel({ b, seasons, step, nav, reload, checks }) {
  const u = unit(b.season.series);
  const lmu = b.season.series === 'lmu';
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
      <div><span class="eyebrow">Konfiguracja sezonu</span><h2>Start sezonu — ${b.season.name}</h2></div>
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

export function SeasonForm({ season, onCancel, onSaved }) {
  const isNew = !season.id;
  const series = season.series ?? 'f1';
  const [f, setF] = useState({
    name: season.name ?? '',
    classes: season.classes?.length ? season.classes : ['HY', 'LMP', 'GT3'],
    team_points: season.team_points || 'final',
    is_current: season.is_current ?? true,
    points: (season.points || DEFAULT_POINTS).join(', '),
    fl_point: season.fl_point ?? (series === 'f1' ? 1 : 0),
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
    const row = {
      name: f.name.trim(), series, format: 'league', is_current: f.is_current, points,
      classes: series === 'lmu' ? LMU_CLASSES.map((c) => c.id).filter((id) => f.classes.includes(id)) : ['HY', 'LMP', 'GT3'],
      team_points: f.team_points,
      fl_point: Number(f.fl_point) || 0, fl_top10: f.fl_top10, pole_point: Number(f.pole_point) || 0, finish_bonus: Number(f.finish_bonus) || 0,
    };
    const saved = await attempt(async () => {
      const s = isNew ? await db.insert('seasons', row) : await db.update('seasons', season.id, row);
      if (row.is_current) {
        const others = await db.list('seasons', { eq: { series, is_current: true } });
        for (const o of others) if (o.id !== s.id) await db.update('seasons', o.id, { is_current: false });
      }
      return s;
    }, isNew ? 'Sezon utworzony — teraz ułóż kalendarz' : 'Zapisano ustawienia');
    if (saved) onSaved(saved);
  };

  return html`<form onSubmit=${submit}>
    <h3>${isNew ? `Nowy sezon — ${series === 'f1' ? 'Formuła 1' : 'Le Mans Ultimate'}` : 'Ustawienia sezonu'}</h3>
    <div class="form-grid">
      <label class="field span2"><span>Nazwa</span><input required value=${f.name} onInput=${set('name')} placeholder="np. Sezon 3 — 2027" /></label>
      ${series === 'lmu' ? html`<div class="field span2"><span>Klasy jadące w sezonie (1–3)</span>
        <div class="class-checks">
          ${LMU_CLASSES.map((c) => html`<label class="class-check" style=${{ '--cls': c.color }}>
            <input type="checkbox" checked=${f.classes.includes(c.id)}
              onChange=${(e) => setF({ ...f, classes: e.target.checked ? [...f.classes, c.id] : f.classes.filter((x) => x !== c.id) })} /> ${c.label}
          </label>`)}
        </div>
        <small class="muted">Wyniki i klasyfikacje są liczone osobno dla każdej klasy.</small>
      </div>` : null}
      ${series === 'f1' ? html`<div class="field span2"><span>Punkty konstruktorów</span>
        ${TEAM_POINTS_MODES.map((m) => html`<label class="radio-line"><input type="radio" name="team_points" checked=${f.team_points === m.id} onChange=${() => setF({ ...f, team_points: m.id })} />
          <span><b>${m.label}</b> — ${m.desc}</span></label>`)}
      </div>` : null}
      <label class="field span2"><span>Punkty za pozycje (od 1. miejsca)</span><input value=${f.points} onInput=${set('points')} /></label>
      <label class="field"><span>Pkt za najszybsze okrążenie</span><input type="number" min="0" value=${f.fl_point} onInput=${set('fl_point')} /></label>
      <label class="field"><span>Pkt za pole position</span><input type="number" min="0" value=${f.pole_point} onInput=${set('pole_point')} /></label>
      <label class="field"><span>Bonus za ukończenie wyścigu</span><input type="number" min="0" value=${f.finish_bonus} onInput=${set('finish_bonus')} /></label>
      <div class="field checks">
        <label><input type="checkbox" checked=${f.fl_top10} onChange=${set('fl_top10')} /> NO punktowane tylko w TOP 10</label>
        <label><input type="checkbox" checked=${f.is_current} onChange=${set('is_current')} /> Bieżący sezon (domyślny na stronie)</label>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-accent">${isNew ? 'Utwórz sezon' : 'Zapisz ustawienia'}</button>
      ${onCancel ? html`<button type="button" class="btn" onClick=${onCancel}>Anuluj</button>` : null}
    </div>
  </form>`;
}

// ---------- kalendarz ----------

function CalendarEditor({ b, reload }) {
  const season = b.season;
  const [add, setAdd] = useState({ track_id: '', race_date: '', laps: '' });
  const races = b.races;
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
    const ok = await attempt(() => db.insert('races', {
      season_id: season.id, round, track_id: add.track_id, race_date: fromLocalInput(add.race_date),
      laps: add.laps ? Number(add.laps) : null, status: 'scheduled', counts: true, notes: '',
    }), `Dodano rundę ${round}`);
    if (ok) {
      setAdd({ ...add, track_id: '', laps: '' });
      reload();
    }
  };
  const patch = async (race, p) => (await attempt(() => db.update('races', race.id, p))) && reload();
  const move = async (i, dir) => {
    const a = races[i];
    const c = races[i + dir];
    if (!c) return;
    await attempt(async () => {
      await db.update('races', a.id, { round: c.round });
      await db.update('races', c.id, { round: a.round });
    });
    reload();
  };
  const remove = async (race) => {
    const t = b.trackById.get(race.track_id);
    if (!confirm(`Usunąć rundę ${race.round} (${t?.name}) wraz z jej wynikami i karami?`)) return;
    const ok = await attempt(async () => {
      await db.removeWhere('results', { race_id: race.id });
      await db.removeWhere('penalties', { race_id: race.id });
      await db.remove('races', race.id);
    }, 'Runda usunięta');
    if (ok) reload();
  };

  return html`
    <h3>Kalendarz — ${races.length} ${races.length === 1 ? 'wyścig' : 'wyścigów'}</h3>
    <form class="subform add-race" onSubmit=${addRace}>
      <div class="form-grid">
        <label class="field span2"><span>Tor</span>
          <select required value=${add.track_id} onChange=${(e) => setAdd({ ...add, track_id: e.target.value })}>
            <option value="">— wybierz tor z bazy —</option>
            ${trackOptions()}
          </select>
        </label>
        <label class="field"><span>Data i godzina</span><input type="datetime-local" value=${add.race_date} onInput=${(e) => setAdd({ ...add, race_date: e.target.value })} /></label>
        <label class="field"><span>Okrążenia</span><input type="number" min="1" value=${add.laps} onInput=${(e) => setAdd({ ...add, laps: e.target.value })} /></label>
      </div>
      <div class="form-actions">
        <button class="btn btn-accent">+ Dodaj rundę</button>
        <a href="#/admin/baza/tory" class="muted">Brakuje toru? Dodaj go w Bazie danych →</a>
      </div>
    </form>

    ${!races.length ? html`<p class="muted">Kalendarz jest pusty.</p>` : html`<div class="table-wrap"><table class="table edit-table">
      <thead><tr><th class="c">Runda</th><th>Tor</th><th>Data</th><th class="c">Okr.</th><th class="c" title="Liczy się do klasyfikacji">Do klasyf.</th><th>Status</th><th class="r"></th></tr></thead>
      <tbody>
        ${races.map((r, i) => html`<tr key=${r.id}>
          <td class="c"><b>${r.round}</b></td>
          <td class="nowrap"><${Flag} code=${b.trackById.get(r.track_id)?.country_code} />
            <select value=${r.track_id} onChange=${(e) => patch(r, { track_id: e.target.value })}>
              ${trackOptions()}
            </select>
          </td>
          <td><input type="datetime-local" value=${toLocalInput(r.race_date)} onChange=${(e) => patch(r, { race_date: fromLocalInput(e.target.value) })} title=${formatDate(r.race_date)} /></td>
          <td class="c"><input class="w-num" type="number" min="1" value=${r.laps ?? ''} onChange=${(e) => patch(r, { laps: e.target.value ? Number(e.target.value) : null })} /></td>
          <td class="c"><input type="checkbox" checked=${r.counts !== false} onChange=${(e) => patch(r, { counts: e.target.checked })} /></td>
          <td>${r.status === 'completed' ? html`<span class="badge badge-ok">Zatwierdzony</span>` : html`<span class="badge">Zaplanowany</span>`}</td>
          <td class="r actions">
            <button class="btn btn-sm" disabled=${i === 0} onClick=${() => move(i, -1)} title="W górę">↑</button>
            <button class="btn btn-sm" disabled=${i === races.length - 1} onClick=${() => move(i, 1)} title="W dół">↓</button>
            <button class="btn btn-sm btn-danger" onClick=${() => remove(r)}>Usuń</button>
          </td>
        </tr>`)}
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

function TeamsEditor({ b, seasons, reload }) {
  const season = b.season;
  const lmu = season.series === 'lmu';
  const t = TEXT[lmu ? 'lmu' : 'f1'];
  const multiClass = lmu;
  const classOptions = seasonClasses(season);
  const [draft, setDraft] = useState(null);
  const [copyFrom, setCopyFrom] = useState('');
  const others = seasons.filter((s) => s.id !== season.id);
  // podpowiedź modeli z Le Mans Ultimate (tylko klasy jadące w sezonie, bez aut już dodanych)
  const carPresets = lmu ? LMU_CARS.filter((c) => classOptions.includes(c.car_class) && !b.teams.some((x) => x.name === c.name)) : [];

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

    ${!b.teams.length && (!lmu || others.length) ? html`<div class="subform">
      <b>Szybki start</b> <span class="muted">(opcjonalnie)</span>
      <div class="form-actions">
        ${!lmu ? html`<button class="btn" onClick=${useF1Template}>Szablon: 11 zespołów F1 2026</button>` : null}
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
      <button class=${`btn ${lmu ? '' : 'btn-accent'}`} onClick=${() => setDraft({ ...emptyTeam(), car_class: classOptions.length === 1 ? classOptions[0] : null })}>${lmu ? '+ Inne auto (wpisz ręcznie)' : t.add}</button>
    </div>`}
  `;
}

// ---------- składy startowe (F1) / przypisanie aut (liga LMU) ----------

function StartingLineup({ b, reload }) {
  const lmu = b.season.series === 'lmu';
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
    <h3>${lmu ? 'Przypisanie aut na start sezonu (runda 1)' : 'Składy na start sezonu (runda 1)'}</h3>
    <p class="muted">${lmu
      ? 'Przypisz każdemu kierowcy auto, którym jedzie. Zmiana auta w trakcie sezonu: kafelek wyścigu → krok „Zmiany aut” (obowiązuje od kolejnej rundy, wcześniejsze wyniki zostają).'
      : 'To skład, z którym zaczyna się sezon. Zmiany w trakcie sezonu wprowadzasz w kafelku wyścigu, w kroku „Zmiany w składach”. Obowiązują one od kolejnej rundy, a wcześniejsze wyniki zostają nietknięte.'}</p>
    ${b.rosterChanges.length ? html`<p class="hint warn">W sezonie zapisano już ${b.rosterChanges.length} zmian. Zmiana na starcie wpływa na wszystkie rundy przed pierwszą zmianą.</p>` : null}
    ${lmu && !b.teams.length ? html`<p class="hint warn">Najpierw dodaj samochody w poprzednim kroku.</p>` : null}
    <div class="lineup-grid">
      ${b.teams.map((x) => html`<div class="lineup-team" style=${{ '--team': x.color || '#888' }}>
        <div class="lineup-team-head"><${TeamLogo} team=${x} size=${28} /> <b>${x.name}</b>
          ${lmu && x.car_class ? html`<span class="class-badge" style=${{ '--cls': carClass(x.car_class)?.color }}>${x.car_class}</span>` : null}</div>
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
