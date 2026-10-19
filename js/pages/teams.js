import { useMemo } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import {
  html, seriesBase, unit, teamHref, teamListHref, useAsync, loadSeasonBundle, Flag, TeamTag, TeamLogo, TeamCar, DriverLink, PosBadge, Loader, ErrorBox, Empty, roleInTeam, ROLE_LABEL,
} from '../ui.js';
import { computeRace, computeStandings, carClass, teamPointsResolver } from '../scoring.js';
import { bundleLineup, teamSeats } from '../lineup.js';

/** Punkty, starty i najlepszy wynik każdego kierowcy w barwach danego zespołu w sezonie. */
function teamDriverStats(b) {
  const map = new Map();
  for (const race of b.races.filter((r) => r.status === 'completed')) {
    for (const row of computeRace(race, b.season, b.results, b.penalties)) {
      if (!row.team_id) continue;
      if (!map.has(row.team_id)) map.set(row.team_id, new Map());
      const m = map.get(row.team_id);
      const d = m.get(row.driver_id) || { driver_id: row.driver_id, points: 0, starts: 0, best: null, wins: 0, podiums: 0 };
      d.points += row.points;
      d.starts++;
      if (row.finalPos) {
        d.best = d.best ? Math.min(d.best, row.finalPos) : row.finalPos;
        if (row.finalPos === 1) d.wins++;
        if (row.finalPos <= 3) d.podiums++;
      }
      m.set(row.driver_id, d);
    }
  }
  return map;
}

/**
 * Kierowcy zespołu w sezonie: obecny skład, rezerwowi przypisani do zespołu oraz wszyscy,
 * którzy zdobywali dla niego punkty (byli kierowcy po zmianie w składzie, zastępstwa).
 * Punkty zespołu nigdy nie znikają: liczą się z wyników, nie z aktualnego składu.
 */
function teamDrivers(b, teamId, stats) {
  const empty = { points: 0, starts: 0, best: null, wins: 0, podiums: 0 };
  const ids = new Set([
    ...teamSeats(bundleLineup(b), teamId).map((s) => s.driver_id),
    ...(stats.get(teamId)?.keys() || []),
  ]);
  const order = { current: 0, former: 1, moved: 2, sub: 3 };
  return [...ids].map((id) => {
    const role = roleInTeam(b, id, teamId);
    return { driver_id: id, role, driver: b.driverById.get(id), stats: stats.get(teamId)?.get(id) || empty };
  }).sort((x, y) => order[x.role] - order[y.role] || y.stats.points - x.stats.points);
}

const ROLE_BADGE = ROLE_LABEL;
// liga LMU: kierowcy jeżdżą autami, a nie w zespołach
const ROLE_BADGE_LMU = { former: 'Wcześniej', moved: 'Zmienił auto', sub: 'Jednorazowo' };
const roleBadge = (b, role) => (b.season.series === 'lmu' ? ROLE_BADGE_LMU : ROLE_BADGE)[role];

// ---------- siatka zespołów sezonu ----------

export function TeamsGrid({ b }) {
  const st = useMemo(() => computeStandings(b), [b]);
  const stats = useMemo(() => teamDriverStats(b), [b]);
  const u = unit(b.season.series);
  if (!b.teams.length) return html`<${Empty}>Brak: ${u.many.toLowerCase()} w tym sezonie nie zostały dodane.<//>`;

  // w lidze LMU nie ma klasyfikacji zespołów — bez pozycji i punktów zespołu
  const ranked = b.season.series === 'f1';
  const posOf = (id) => {
    const i = st.teams.findIndex((t) => t.team_id === id);
    return i < 0 ? null : i + 1;
  };
  const sorted = [...b.teams].sort((x, y) => (posOf(x.id) ?? 99) - (posOf(y.id) ?? 99) || x.name.localeCompare(y.name));

  return html`
    <div class="page-head"><h2>${u.many} — ${b.season.name}</h2><span class="muted">${b.teams.length} ${u.gen}</span></div>
    <div class="tgrid">
      ${sorted.map((team) => {
        const s = st.teams.find((t) => t.team_id === team.id);
        const pos = posOf(team.id);
        const href = teamHref(b.season.series, team.id);
        return html`<article class="tcard" style=${{ '--team': team.color || '#888' }}>
          <a class="tcard-head" href=${href}>
            <${TeamLogo} team=${team} size=${52} />
            <div class="tcard-title">
              <h3>${team.name}</h3>
              ${team.car_class && !ranked ? html`<span class="class-badge" style=${{ '--cls': carClass(team.car_class)?.color }}>${carClass(team.car_class)?.label}</span>` : null}
            </div>
            ${pos && ranked ? html`<span class="tcard-pos">P${pos}</span>` : null}
          </a>
          <a class="tcard-car" href=${href} tabindex="-1" aria-hidden="true"><${TeamCar} team=${team} /></a>
          <div class=${`tcard-stats ${ranked ? '' : 'two'}`}>
            ${ranked ? html`<div><b>${s?.points ?? 0}</b><span>pkt</span></div>` : null}
            <div><b>${s?.wins ?? 0}</b><span>wygrane</span></div>
            <div><b>${s?.podiums ?? 0}</b><span>podia</span></div>
          </div>
          <ul class="tcard-drivers">
            ${teamDrivers(b, team.id, stats).map((d) => html`<li class=${d.role === 'current' ? '' : 'li-other'}>
              <${DriverLink} driver=${d.driver} />
              ${d.role !== 'current' ? html`<span class="badge">${roleBadge(b, d.role)}</span>` : null}
              <span class="pts">${d.stats.points}</span>
            </li>`)}
          </ul>
          <a class="tcard-more" href=${href}>${u.profile} →</a>
        </article>`;
      })}
    </div>`;
}

// ---------- profil zespołu ----------

export function TeamPage({ teamId }) {
  const data = useAsync(async () => {
    const [team] = await db.list('teams', { eq: { id: teamId } });
    if (!team) return null;
    const b = await loadSeasonBundle(team.season_id);
    return { team, b };
  }, [teamId]);

  if (data.loading) return html`<${Loader} />`;
  if (data.error) return html`<${ErrorBox} error=${data.error} />`;
  if (!data.data) return html`<${Empty}>Nie znaleziono zespołu.<//>`;
  return html`<${TeamProfile} ...${data.data} />`;
}

function TeamProfile({ team, b }) {
  const st = computeStandings(b);
  const stats = teamDriverStats(b);
  const idx = st.teams.findIndex((t) => t.team_id === team.id);
  const s = st.teams[idx];
  const drivers = teamDrivers(b, team.id, stats);
  const changes = (b.rosterChanges || []).filter((c) => c.team_id === team.id);
  const ranked = b.season.series === 'f1'; // LMU: bez klasyfikacji zespołów

  // wyścig po wyścigu: kto jechał w barwach zespołu i ile punktów zdobył zespół
  const teamOf = teamPointsResolver(b);
  const rounds = st.races.map((race) => {
    const all = computeRace(race, b.season, b.results, b.penalties);
    const rows = all.filter((r) => r.team_id === team.id || teamOf(race, r) === team.id);
    // punkty zespołu: tylko wyniki zaliczane temu zespołowi (zasada z ustawień sezonu)
    return { race, rows, points: all.filter((r) => teamOf(race, r) === team.id).reduce((sum, r) => sum + r.points, 0) };
  });
  const poles = rounds.reduce((n, r) => n + r.rows.filter((x) => x.hasPole).length, 0);
  const fls = rounds.reduce((n, r) => n + r.rows.filter((x) => x.hasFastestLap).length, 0);

  return html`
    <a class="back" href=${teamListHref(b.season.series)}>← ${ranked ? 'Wszystkie zespoły' : 'Wszystkie samochody'}</a>
    <section class="thero" style=${{ '--team': team.color || '#888' }}>
      <div class="thero-info">
        <${TeamLogo} team=${team} size=${84} />
        <div>
          <div class="eyebrow">${b.season.name}</div>
          <h2>${team.name}</h2>
          ${ranked ? html`<div class="thero-badges">
            ${s ? html`<span class="thero-pos">P${idx + 1}</span><span><b>${s.points}</b> pkt</span>` : html`<span class="muted">Brak punktów</span>`}
          </div>` : team.car_class ? html`<span class="class-badge" style=${{ '--cls': carClass(team.car_class)?.color }}>${carClass(team.car_class)?.label}</span>` : null}
        </div>
      </div>
      <div class="thero-car"><${TeamCar} team=${team} /></div>
    </section>

    <div class="stat-grid">
      ${[
        ...(ranked ? [['Pozycja', s ? `P${idx + 1}` : '—'], ['Punkty', s?.points ?? 0]] : []), ['Wygrane', s?.wins ?? 0],
        ['Podia', s?.podiums ?? 0], ['Pole', poles], ['Najszybsze okr.', fls],
      ].map(([l, v]) => html`<div class="stat"><b>${v}</b><span>${l}</span></div>`)}
    </div>

    <h3>Kierowcy</h3>
    ${!drivers.length ? html`<${Empty}>Brak przypisanych kierowców.<//>` : html`<div class="tdrivers">
      ${drivers.map((d) => html`<div class=${`tdriver ${d.role === 'current' ? '' : 'tdriver-other'}`}>
        <div class="tdriver-num">${d.driver?.number ?? ''}</div>
        <div class="tdriver-body">
          <${DriverLink} driver=${d.driver} />
          ${d.role !== 'current' ? html`<span class="badge">${roleBadge(b, d.role)}</span>` : null}
          <div class="muted">${d.stats.starts} startów dla zespołu · najlepiej ${d.stats.best ? `P${d.stats.best}` : '—'}${d.stats.wins ? ` · ${d.stats.wins} wygr.` : ''}${d.stats.podiums ? ` · ${d.stats.podiums} podia` : ''}</div>
        </div>
        <div class="tdriver-pts"><b>${d.stats.points}</b><span>pkt</span></div>
      </div>`)}
    </div>`}

    ${changes.length ? html`
      <h3>${ranked ? 'Zmiany w składzie' : 'Zmiany przypisań'}</h3>
      <ul class="roster-log">
        ${changes.map((c) => {
          const race = b.races.find((r) => r.round === c.from_round);
          const t = race && b.trackById.get(race.track_id);
          return html`<li>
            <span class="roster-round">od R${c.from_round}${t ? html` · <${Flag} code=${t.country_code} size=${16} /> ${t.name}` : null}</span>
            <span>${c.driver_in_id ? html`<b class="in">▲ ${b.driverById.get(c.driver_in_id)?.nick}</b>` : null}${c.driver_in_id && c.driver_out_id ? ' za ' : ''}${c.driver_out_id ? html`<b class="out">▼ ${b.driverById.get(c.driver_out_id)?.nick}</b>` : null}${!c.driver_out_id ? ' dołącza' : !c.driver_in_id ? ' odchodzi' : ''}</span>
            ${c.note ? html`<span class="muted">${c.note}</span>` : null}
          </li>`;
        })}
      </ul>
      <p class="hint">Punkty zdobyte przed zmianą zostają na koncie zespołu, a punkty indywidualne przy kierowcy.</p>` : null}

    <h3>Wyścig po wyścigu</h3>
    ${!rounds.length ? html`<${Empty}>Brak rozegranych wyścigów.<//>` : html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Runda</th><th>Wyniki kierowców</th>${ranked ? html`<th class="r">Pkt zespołu</th>` : null}</tr></thead>
      <tbody>
        ${rounds.map(({ race, rows, points }) => {
          const t = b.trackById.get(race.track_id);
          return html`<tr>
            <td class="nowrap"><a href=${`${seriesBase(b.season.series)}/wyniki/${race.id}`}><span class="muted">R${race.round}</span> <${Flag} code=${t?.country_code} size=${18} /> ${t?.name}</a></td>
            <td><div class="round-results">
              ${rows.length ? rows.map((r) => html`<span class="rr"><${PosBadge} pos=${r.finalPos} status=${r.status} /> ${b.driverById.get(r.driver_id)?.nick}</span>`) : html`<span class="muted">—</span>`}
            </div></td>
            ${ranked ? html`<td class="r pts">${points}</td>` : null}
          </tr>`;
        })}
      </tbody>
    </table></div>`}
  `;
}
