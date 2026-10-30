import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, seriesBase, unit, teamHref, useAsync, loadSeasonBundle, driverSeat, sessionLabel, Flag, TeamTag, TeamCar, DriverLink, PosBadge, Loader, ErrorBox, Empty, formatDate } from '../ui.js';
import { computeRaceByClass, computeStandings, CAR_CLASSES, carClass, isSprint } from '../scoring.js';
import { classBundle } from './league.js';
import { loadEndurance, ClassBadge as EndClassBadge } from './endurance.js';

// Profil kierowcy — wspólny dla wszystkich serii: Liga F1, Liga LMU (podział na sezony i auta) oraz Endurance (przejazdy).
// Adres: #/kierowca/<id>[/f1|lmu|endurance]

const SERIES = [
  { id: 'f1', label: 'Liga F1', color: '#e10600' },
  { id: 'lmu', label: 'Liga LMU', color: '#0a6cff' },
  { id: 'endurance', label: 'Endurance', color: 'var(--accent)' },
];

export function DriverPage({ driverId, tab }) {
  const data = useAsync(async () => {
    const seasons = await db.list('seasons', { order: ['created_at'] });
    const [bundles, end] = await Promise.all([Promise.all(seasons.map((s) => loadSeasonBundle(s.id))), loadEndurance()]);
    return { bundles, end };
  }, [driverId]);

  let body;
  let driver = null;
  if (data.loading) body = html`<${Loader} />`;
  else if (data.error) body = html`<${ErrorBox} error=${data.error} />`;
  else {
    const { bundles, end } = data.data;
    driver = bundles[0]?.driverById.get(driverId) ?? end.driverById.get(driverId) ?? null;
    body = driver
      ? html`<${Profile} bundles=${bundles} end=${end} driverId=${driverId} initial=${tab} />`
      : html`<${Empty}>Nie znaleziono kierowcy.<//>`;
  }

  return html`<div>
    <div class="section-head">
      <div class="wrap section-head-inner">
        <div class="section-title">
          <span class="series-chip admin">KIEROWCA</span>
          ${driver?.avatar_url ? html`<img class="driver-avatar" src=${driver.avatar_url} alt="" />` : null}
          ${driver ? html`<${Flag} code=${driver.country_code} size=${32} />` : null}
          <h1>${driver?.number != null && driver?.number !== '' ? html`<span class="num big">${driver.number}</span> ` : null}${driver?.nick ?? 'Profil kierowcy'}</h1>
        </div>
      </div>
    </div>
    <div class="wrap page">${body}</div>
  </div>`;
}

// ---------- dane ----------

function collectHistory(bundles, driverId) {
  const history = [];
  for (const b of bundles) {
    for (const race of b.sessions.filter((r) => r.status === 'completed')) {
      const row = computeRaceByClass(race, b.season, b.results, b.penalties).find((r) => r.driver_id === driverId);
      if (row) history.push({ b, race, row });
    }
  }
  // kolejność: data, a przy równej (lub brakującej) dacie — runda i sprint przed wyścigiem głównym
  return history.sort((x, y) => new Date(x.race.race_date || 0) - new Date(y.race.race_date || 0)
    || x.race.round - y.race.round || Number(isSprint(y.race)) - Number(isSprint(x.race)));
}

/** Przejazdy w Endurance: każdy event, w którym kierowca był w składzie któregoś zespołu SSP (od najnowszych). */
function collectRuns(end, driverId) {
  const runs = [];
  for (const ev of [...end.upcoming, ...end.finished]) {
    for (const crew of end.crewsOf(ev.id)) {
      if ((crew.driver_ids || []).includes(driverId)) runs.push({ ev, crew });
    }
  }
  return runs.sort((x, y) => new Date(y.ev.start_at || 0) - new Date(x.ev.start_at || 0));
}

/** Statystyki: punkty ze wszystkich sesji, a starty, wygrane, podia itd. tylko z wyścigów głównych (bez sprintów). */
function summarize(all) {
  const items = all.filter((h) => !isSprint(h.race));
  const finished = items.filter((h) => h.row.classPos);
  return {
    starts: items.length,
    points: all.reduce((s, h) => s + h.row.points, 0),
    wins: finished.filter((h) => h.row.classPos === 1).length,
    podiums: finished.filter((h) => h.row.classPos <= 3).length,
    poles: items.filter((h) => h.row.hasPole).length,
    fls: items.filter((h) => h.row.hasFastestLap).length,
    dnfs: items.filter((h) => h.row.status !== 'FIN').length,
    best: finished.length ? Math.min(...finished.map((h) => h.row.classPos)) : null,
    avg: finished.length ? (finished.reduce((s, h) => s + h.row.classPos, 0) / finished.length).toFixed(1) : null,
  };
}

/** Sezony kierowcy w serii (od najnowszego): wyścigi, auta/zespoły i miejsce w klasyfikacji. */
function seasonsOf(items, driverId) {
  const map = new Map();
  for (const h of items) {
    if (!map.has(h.b.season.id)) map.set(h.b.season.id, { b: h.b, items: [] });
    map.get(h.b.season.id).items.push(h);
  }
  return [...map.values()].reverse().map(({ b, items: list }) => {
    // auta (LMU) / zespoły (F1), którymi jechał — z wyników, a gdy ich brak: ze składu
    const teamIds = [...new Set(list.map((h) => h.row.team_id).filter(Boolean))];
    const teams = teamIds.length ? teamIds.map((id) => b.teamById.get(id)).filter(Boolean) : [driverSeat(b, driverId).team].filter(Boolean);
    // miejsce w klasyfikacji (w LMU osobno w każdej klasie, w której jechał)
    const classes = b.season.series === 'lmu' ? [...new Set(list.map((h) => h.row.carClass))] : [null];
    const places = classes.map((cls) => {
      const st = computeStandings(classBundle(b, cls));
      const i = st.drivers.findIndex((x) => x.driver_id === driverId);
      return { cls, pos: i >= 0 ? i + 1 : null, of: st.drivers.length };
    });
    return { b, season: b.season, items: list, teams, places, s: summarize(list) };
  });
}

// ---------- widok ----------

function Profile({ bundles, end, driverId, initial }) {
  const history = collectHistory(bundles, driverId);
  const bySeries = {
    f1: history.filter((h) => h.b.season.series === 'f1'),
    lmu: history.filter((h) => h.b.season.series === 'lmu'),
  };
  const runs = collectRuns(end, driverId);
  const starts = (items) => items.filter((h) => !isSprint(h.race)).length; // sprinty nie są osobnymi startami
  const count = { f1: starts(bySeries.f1), lmu: starts(bySeries.lmu), endurance: runs.length };

  // domyślnie seria z najświeższym startem
  const last = {
    f1: bySeries.f1.at(-1)?.race.race_date,
    lmu: bySeries.lmu.at(-1)?.race.race_date,
    endurance: runs.find((r) => r.ev.status === 'finished')?.ev.start_at || runs[0]?.ev.start_at,
  };
  const fallback = SERIES.filter((x) => count[x.id]).sort((a, c) => new Date(last[c.id] || 0) - new Date(last[a.id] || 0))[0]?.id || 'f1';
  const [tab, setTab] = useState(SERIES.some((x) => x.id === initial && count[x.id]) ? initial : fallback);
  const pick = (id) => {
    setTab(id);
    window.history.replaceState(null, '', `#/kierowca/${driverId}/${id}`);
  };

  const label = (id) => {
    const n = count[id];
    if (!n) return 'brak startów';
    if (id === 'endurance') {
      const done = runs.filter((r) => r.ev.status === 'finished').length;
      const next = n - done;
      return [done ? plural(done, 'przejazd', 'przejazdy', 'przejazdów') : null, next ? plural(next, 'nadchodzący', 'nadchodzące', 'nadchodzących') : null].filter(Boolean).join(' · ');
    }
    return plural(n, 'start', 'starty', 'startów');
  };

  return html`
    <div class="class-chips series-tabs" role="tablist">
      ${SERIES.map((x) => html`<button role="tab" aria-selected=${tab === x.id} disabled=${!count[x.id]}
        class=${`class-chip ${tab === x.id ? 'active' : ''}`} style=${{ '--cls': x.color }} onClick=${() => pick(x.id)}>
        <b>${x.label}</b><span>${label(x.id)}</span>
      </button>`)}
    </div>
    ${!history.length && !runs.length ? html`<${Empty}>Ten kierowca nie ma jeszcze żadnych startów.<//>` : null}
    ${tab === 'endurance'
      ? (runs.length ? html`<${EnduranceRuns} runs=${runs} end=${end} driverId=${driverId} />` : null)
      : (count[tab] ? html`<${LeagueView} key=${tab} series=${tab} items=${bySeries[tab]} driverId=${driverId} />` : null)}
  `;
}

const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`;

function StatGrid({ s }) {
  const stats = [
    ['Starty', s.starts],
    ['Punkty', s.points],
    ['Wygrane', s.wins],
    ['Podia', s.podiums],
    ['Pole', s.poles],
    ['Najszybsze okr.', s.fls],
    ['Najlepsza poz.', s.best ?? '—'],
    ['Śr. pozycja', s.avg ?? '—'],
    ['Nieukończone', s.dnfs],
  ];
  return html`<div class="stat-grid">${stats.map(([l, v]) => html`<div class="stat"><b>${v}</b><span>${l}</span></div>`)}</div>`;
}

const Place = ({ p, lmu }) => (p.pos
  ? html`<span class="season-place"><b>P${p.pos}</b>${lmu && p.cls ? html` <${ClassBadge} id=${p.cls} />` : null} <span class="muted">/ ${p.of}</span></span>`
  : html`<span class="muted">—</span>`);

/** Liga F1 / Liga LMU: wszystkie sezony albo wybrany sezon (auto / zespół, statystyki, wyścigi). */
function LeagueView({ series, items, driverId }) {
  const seasons = seasonsOf(items, driverId);
  const [sel, setSel] = useState(seasons[0]?.season.id || 'ALL');
  const lmu = series === 'lmu';
  const u = unit(series);
  const current = seasons.find((x) => x.season.id === sel);

  return html`
    <div class="season-pills" role="tablist">
      <button role="tab" aria-selected=${sel === 'ALL'} class=${`season-pill ${sel === 'ALL' ? 'active' : ''}`} onClick=${() => setSel('ALL')}>Wszystkie sezony</button>
      ${seasons.map((x) => html`<button role="tab" aria-selected=${sel === x.season.id} class=${`season-pill ${sel === x.season.id ? 'active' : ''}`} onClick=${() => setSel(x.season.id)}>
        ${x.season.name}${x.season.is_current ? html` <span class="dot-live" title="Bieżący sezon"></span>` : null}
      </button>`)}
    </div>

    ${current ? html`<${SeasonView} x=${current} lmu=${lmu} u=${u} />` : html`
      <${StatGrid} s=${summarize(items)} />
      ${lmu ? html`<p class="hint">Pozycje, wygrane i podia liczone są w obrębie klasy.</p>` : null}

      <h3>Sezony</h3>
      <div class="table-wrap"><table class="table table-click">
        <thead><tr>
          <th>Sezon</th><th>${lmu ? 'Auto' : 'Zespół'}</th><th class="c">Miejsce</th><th class="c">Starty</th><th class="c">Wygr.</th><th class="c">Podia</th>
          <th class="c hide-sm">Pole</th><th class="c hide-sm">NO</th><th class="r">Pkt</th>
        </tr></thead>
        <tbody>
          ${seasons.map((x) => html`<tr key=${x.season.id} onClick=${() => setSel(x.season.id)} title="Pokaż sezon">
            <td><b>${x.season.name}</b></td>
            <td><div class="season-teams">${x.teams.map((t) => html`<span>${lmu ? html`<${ClassBadge} id=${t.car_class} /> ` : null}<${TeamTag} team=${t} link=${false} /></span>`)}</div></td>
            <td class="c">${x.places.map((p) => html`<div><${Place} p=${p} lmu=${lmu} /></div>`)}</td>
            <td class="c">${x.s.starts}</td>
            <td class="c">${x.s.wins || '·'}</td>
            <td class="c">${x.s.podiums || '·'}</td>
            <td class="c hide-sm">${x.s.poles || '·'}</td>
            <td class="c hide-sm">${x.s.fls || '·'}</td>
            <td class="r pts">${x.s.points}</td>
          </tr>`)}
        </tbody>
      </table></div>

      ${lmu ? html`<${ClassTable} items=${items} />` : null}
    `}
  `;
}

function SeasonView({ x, lmu, u }) {
  const { b, season, teams, places, s } = x;
  const base = seriesBase(season.series);
  const many = teams.length > 1;
  return html`
    <div class="season-cars">
      ${teams.map((t) => html`<a class="season-car" href=${teamHref(season.series, t.id)} style=${{ '--team': t.color || carClass(t.car_class)?.color || '#888' }}>
        <div class="season-car-img"><${TeamCar} team=${t} /></div>
        <div class="season-car-body">
          <span class="field-label">${many ? (lmu ? 'Auto' : 'Zespół') : (lmu ? `Auto w sezonie ${season.name}` : `Zespół w sezonie ${season.name}`)}</span>
          <b>${t.name}</b>
          ${lmu && t.car_class ? html`<${ClassBadge} id=${t.car_class} long />` : null}
          <span class="muted small">${plural(x.items.filter((h) => h.row.team_id === t.id && !isSprint(h.race)).length, 'wyścig', 'wyścigi', 'wyścigów')} · ${u.profile} →</span>
        </div>
      </a>`)}
      <div class="season-place-card">
        <span class="field-label">Klasyfikacja</span>
        ${places.map((p) => html`<div><${Place} p=${p} lmu=${lmu} /></div>`)}
        <a class="small" href=${`${base}/klasyfikacja`}>Pełna klasyfikacja →</a>
      </div>
    </div>

    <${StatGrid} s=${s} />

    <h3>Wyścigi — ${season.name}</h3>
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th class="c">R</th><th class="hide-sm">Data</th><th>Tor</th>${lmu ? html`<th class="c">Klasa</th>` : null}
        ${many || !lmu ? html`<th class="hide-sm">${lmu ? 'Auto' : 'Zespół'}</th>` : null}
        <th class="c">Start</th><th class="c" title=${lmu ? 'Pozycja w klasie' : 'Pozycja na mecie'}>Meta</th><th class="r">Pkt</th>
      </tr></thead>
      <tbody>
        ${x.items.slice().reverse().map(({ race, row }) => {
          const t = b.trackById.get(race.track_id);
          return html`<tr>
            <td class="c muted nowrap">${sessionLabel(race, true)}</td>
            <td class="muted hide-sm nowrap">${formatDate(race.race_date, false)}</td>
            <td><a href=${`${base}/wyniki/${race.id}`}><${Flag} code=${t?.country_code} size=${18} /> ${t?.name ?? '?'}</a>${isSprint(race) ? html` <span class="badge badge-sprint">Sprint</span>` : null}</td>
            ${lmu ? html`<td class="c"><${ClassBadge} id=${row.carClass} /></td>` : null}
            ${many || !lmu ? html`<td class="hide-sm"><${TeamTag} team=${b.teamById.get(row.team_id)} base=${base} /></td>` : null}
            <td class="c">${row.grid || '—'}</td>
            <td class="c"><${PosBadge} pos=${row.classPos} status=${row.status} />${row.hasFastestLap ? html` <span class="badge badge-fl" title="Najszybsze okrążenie">NO</span>` : null}</td>
            <td class="r pts">${row.points}</td>
          </tr>`;
        })}
      </tbody>
    </table></div>
  `;
}

function ClassBadge({ id, long = false }) {
  const c = carClass(id);
  if (!c) return html`<span class="badge">?</span>`;
  return html`<span class="class-badge" style=${{ '--cls': c.color }}>${long ? c.label : c.id}</span>`;
}

/** LMU: podsumowanie w podziale na klasy (tylko klasy, w których kierowca startował). */
function ClassTable({ items }) {
  const rows = CAR_CLASSES.map((c) => ({ c, x: summarize(items.filter((h) => h.row.carClass === c.id)) })).filter((r) => r.x.starts);
  if (rows.length < 2) return null;
  return html`
    <h3>Podział na klasy</h3>
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th>Klasa</th><th class="c">Starty</th><th class="c">Wygr.</th><th class="c">Podia</th>
        <th class="c hide-sm">Pole</th><th class="c hide-sm">NO</th><th class="c hide-sm">Najl.</th><th class="c hide-sm">Śr.</th><th class="r">Pkt</th>
      </tr></thead>
      <tbody>
        ${rows.map(({ c, x }) => html`<tr style=${{ '--team': c.color }}>
          <td><span class="class-name"><${ClassBadge} id=${c.id} /> ${c.label}</span></td>
          <td class="c">${x.starts}</td>
          <td class="c">${x.wins || '·'}</td>
          <td class="c">${x.podiums || '·'}</td>
          <td class="c hide-sm">${x.poles || '·'}</td>
          <td class="c hide-sm">${x.fls || '·'}</td>
          <td class="c hide-sm">${x.best ?? '—'}</td>
          <td class="c hide-sm">${x.avg ?? '—'}</td>
          <td class="r pts">${x.points}</td>
        </tr>`)}
      </tbody>
    </table></div>
  `;
}

// ---------- Endurance ----------

function RunResult({ crew }) {
  if (crew.result_status && crew.result_status !== 'FIN') return html`<span class="pos pos-out">${crew.result_status}</span>`;
  if (!crew.position_class) return html`<span class="muted small">brak wyniku</span>`;
  return html`<span class="run-result">
    <span class=${`pos ${crew.position_class <= 3 ? `pos-${crew.position_class}` : ''}`}>P${crew.position_class}</span>
    <span class="muted small">w klasie${crew.position_overall ? ` · P${crew.position_overall} ogólnie` : ''}${crew.laps ? ` · ${crew.laps} okr.` : ''}</span>
  </span>`;
}

function EnduranceRuns({ runs, end, driverId }) {
  const done = runs.filter((r) => r.ev.status === 'finished');
  const upcoming = runs.filter((r) => r.ev.status !== 'finished').reverse();
  const classed = done.filter((r) => r.crew.position_class && (!r.crew.result_status || r.crew.result_status === 'FIN'));
  const hours = done.reduce((s, r) => s + (Number(r.ev.duration_hours) || 0), 0);
  const stats = [
    ['Przejazdy', done.length],
    ['Wygrane w klasie', classed.filter((r) => r.crew.position_class === 1).length],
    ['Podia w klasie', classed.filter((r) => r.crew.position_class <= 3).length],
    ['Ukończone', done.filter((r) => r.crew.result_status === 'FIN' || (!r.crew.result_status && r.crew.position_class)).length],
    ['Najlepsza poz.', classed.length ? `P${Math.min(...classed.map((r) => r.crew.position_class))}` : '—'],
    ['Godziny wyścigów', hours ? Math.round(hours * 10) / 10 : '—'],
  ];

  const Run = ({ ev, crew }) => {
    const track = end.trackById.get(ev.track_id);
    const mates = (crew.driver_ids || []).filter((id) => id !== driverId).map((id) => end.driverById.get(id));
    const finished = ev.status === 'finished';
    return html`<article class="run-card" style=${{ '--cls': carClass(crew.car_class)?.color || 'var(--accent)' }}>
      <div class="run-car">
        ${crew.car_image_url ? html`<img src=${crew.car_image_url} alt=${crew.car_model || crew.name} loading="lazy" />` : html`<div class="cal-nodata">Brak zdjęcia</div>`}
      </div>
      <div class="run-body">
        <div class="run-head">
          <a class="run-event" href=${`#/lmu/endurance/${finished ? 'wyniki' : 'kalendarz'}/${ev.id}`}>${ev.name}</a>
          <span class="muted small">${ev.start_at ? formatDate(ev.start_at, false) : 'termin do ustalenia'}${ev.duration_hours ? ` · ${Number(ev.duration_hours)} h` : ''}</span>
        </div>
        ${track ? html`<div class="muted small"><${Flag} code=${track.country_code} size=${16} /> ${track.name}</div>` : null}
        <div class="run-crew">
          ${crew.car_number ? html`<span class="crew-num">#${crew.car_number}</span>` : null}
          <b>${crew.name}</b>
          <${EndClassBadge} id=${crew.car_class} />
          ${crew.car_model ? html`<span class="muted">${crew.car_model}</span>` : null}
        </div>
        <div class="run-mates">
          <span class="field-label">Załoga</span>
          ${mates.length ? mates.map((d) => html`<${DriverLink} driver=${d} />`) : html`<span class="muted small">jechał sam</span>`}
        </div>
      </div>
      <div class="run-res">
        ${finished ? html`<${RunResult} crew=${crew} />` : html`<span class="badge">Nadchodzący</span>`}
        ${crew.hall_of_fame ? html`<a class="badge badge-hof" href="#/galeria" title="Wynik w Galerii sław">🏆 Galeria sław</a>` : null}
      </div>
    </article>`;
  };

  return html`
    <div class="stat-grid">${stats.map(([l, v]) => html`<div class="stat"><b>${v}</b><span>${l}</span></div>`)}</div>
    ${upcoming.length ? html`<h3>Nadchodzące</h3><div class="run-list">${upcoming.map((r) => html`<${Run} key=${r.crew.id} ...${r} />`)}</div>` : null}
    <h3>Przejazdy</h3>
    ${done.length ? html`<div class="run-list">${done.map((r) => html`<${Run} key=${r.crew.id} ...${r} />`)}</div>` : html`<${Empty}>Brak zakończonych przejazdów.<//>`}
  `;
}
