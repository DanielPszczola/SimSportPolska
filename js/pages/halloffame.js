import { html, useAsync, listSeasons, loadSeasonBundle, seriesBase, teamHref, Loader, ErrorBox, Empty, Flag, DriverLink, TeamTag, TeamLogo, formatDate, formatHours } from '../ui.js';
import { computeStandings, carClass, seasonClasses } from '../scoring.js';
import { classBundle } from './league.js';
import { loadEndurance, ClassBadge } from './endurance.js';

// Galeria sław: mistrzowie każdego sezonu F1 i ligi LMU (w kolejności rozegrania)
// oraz największe sukcesy Endurance wybrane przez admina (pole „Pokaż w Galerii sław”).

/** Stan sezonu: zakończony (wszystkie rundy rozegrane), w trakcie albo jeszcze nierozpoczęty. */
function seasonState(b) {
  const done = b.races.filter((r) => r.status === 'completed').length;
  if (!done) return 'planned';
  return done === b.races.length ? 'finished' : 'running';
}

async function loadHallOfFame() {
  const [f1Seasons, lmuSeasons, endurance] = await Promise.all([listSeasons('f1'), listSeasons('lmu'), loadEndurance()]);
  // od najstarszego sezonu (kolejność rozegrania)
  const chrono = (list) => [...list].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const [f1, lmu] = await Promise.all([
    Promise.all(chrono(f1Seasons).map((s) => loadSeasonBundle(s.id))),
    Promise.all(chrono(lmuSeasons).map((s) => loadSeasonBundle(s.id))),
  ]);
  return { f1, lmu, endurance };
}

export function HallOfFamePage() {
  const data = useAsync(loadHallOfFame, []);
  let body;
  if (data.loading) body = html`<${Loader} />`;
  else if (data.error) body = html`<${ErrorBox} error=${data.error} />`;
  else body = html`<${HallOfFame} d=${data.data} />`;
  return html`<div>
    <div class="section-head">
      <div class="wrap section-head-inner">
        <div class="section-title"><span class="series-chip hof-chip">🏆</span><h1>Galeria sław</h1></div>
      </div>
    </div>
    <div class="wrap page">${body}</div>
  </div>`;
}

function HallOfFame({ d }) {
  const f1 = d.f1.map((b) => ({ b, state: seasonState(b), st: computeStandings(b) })).filter((x) => x.state !== 'planned');
  const lmu = d.lmu.map((b) => ({
    b,
    state: seasonState(b),
    classes: seasonClasses(b.season).map((cls) => {
      const cb = classBundle(b, cls);
      return { cls, b: cb, st: computeStandings(cb) };
    }),
  })).filter((x) => x.state !== 'planned');

  const hof = d.endurance.finished.flatMap((ev) => d.endurance.crewsOf(ev.id).filter((c) => c.hall_of_fame).map((crew) => ({ ev, crew })));

  if (!f1.length && !lmu.length && !hof.length) return html`<${Empty}>Galeria sław zapełni się po pierwszym rozegranym sezonie.<//>`;

  return html`
    ${f1.length ? html`<section class="hof-section">
      <h2><span class="series-chip">F1</span> Mistrzowie F1</h2>
      <div class="hof-seasons">
        ${f1.map((x) => html`<${F1SeasonCard} x=${x} />`)}
      </div>
    </section>` : null}

    ${lmu.length ? html`<section class="hof-section">
      <h2><span class="series-chip lmu">LMU</span> Mistrzowie ligi Le Mans Ultimate</h2>
      <div class="hof-seasons">
        ${lmu.map((x) => html`<${LmuSeasonCard} x=${x} />`)}
      </div>
    </section>` : null}

    <section class="hof-section">
      <h2><span class="series-chip hof-chip">END</span> Największe sukcesy Endurance</h2>
      ${hof.length ? html`<div class="hof-endurance">
        ${hof.map(({ ev, crew }) => html`<${EnduranceCard} ev=${ev} crew=${crew} d=${d.endurance} />`)}
      </div>` : html`<p class="muted">Admin może wybrać wyniki do Galerii sław w panelu <b>LMU Endurance</b> (pole „Pokaż w Galerii sław” przy wyniku zespołu).</p>`}
    </section>
  `;
}

function StateBadge({ state, b }) {
  if (state === 'finished') return html`<span class="badge badge-ok">Zakończony</span>`;
  const done = b.races.filter((r) => r.status === 'completed').length;
  return html`<span class="badge badge-warn">Trwa · po ${done} z ${b.races.length} rund</span>`;
}

function Podium3({ rows, b }) {
  return html`<ol class="hof-podium">
    ${rows.slice(1, 3).map((d, i) => html`<li><span class=${`pos pos-${i + 2}`}>${i + 2}</span><${DriverLink} driver=${b.driverById.get(d.driver_id)} /><span class="pts">${d.points}</span></li>`)}
  </ol>`;
}

function F1SeasonCard({ x }) {
  const { b, st, state } = x;
  const driver = st.drivers[0];
  const team = st.teams[0] && b.teamById.get(st.teams[0].team_id);
  const champTeam = driver && b.teamById.get(driver.team_id);
  const finished = state === 'finished';
  return html`<article class=${`hof-card ${finished ? '' : 'running'}`}>
    <header class="hof-card-head">
      <h3>${b.season.name}</h3>
      <${StateBadge} state=${state} b=${b} />
    </header>
    <div class="hof-champs">
      ${driver ? html`<div class="hof-champ" style=${{ '--team': champTeam?.color || 'var(--gold)' }}>
        <div class="eyebrow">${finished ? '🏆 Mistrz kierowców' : 'Prowadzi — kierowcy'}</div>
        <div class="hof-champ-name"><${DriverLink} driver=${b.driverById.get(driver.driver_id)} /></div>
        <div class="muted small">${champTeam ? html`<${TeamTag} team=${champTeam} base=${seriesBase('f1')} /> · ` : ''}${driver.points} pkt · ${driver.wins} wygr.</div>
        <${Podium3} rows=${st.drivers} b=${b} />
      </div>` : null}
      ${team ? html`<div class="hof-champ" style=${{ '--team': team.color || 'var(--gold)' }}>
        <div class="eyebrow">${finished ? '🏆 Mistrz konstruktorów' : 'Prowadzi — konstruktorzy'}</div>
        <div class="hof-champ-name hof-team"><${TeamLogo} team=${team} size=${32} /> <a href=${teamHref('f1', team.id)}>${team.name}</a></div>
        <div class="muted small">${st.teams[0].points} pkt · ${st.teams[0].wins} wygr.</div>
        ${team.car_url ? html`<img class="hof-car" src=${team.car_url} alt="" loading="lazy" />` : null}
      </div>` : null}
    </div>
  </article>`;
}

function LmuSeasonCard({ x }) {
  const { b, state, classes } = x;
  const finished = state === 'finished';
  return html`<article class=${`hof-card ${finished ? '' : 'running'}`}>
    <header class="hof-card-head">
      <h3>${b.season.name}</h3>
      <${StateBadge} state=${state} b=${b} />
    </header>
    <div class="hof-champs">
      ${classes.map(({ cls, b: cb, st }) => {
        const top = st.drivers[0];
        const car = top && cb.teamById.get(top.team_id);
        return html`<div class="hof-champ" style=${{ '--team': carClass(cls)?.color }}>
          <div class="eyebrow"><${ClassBadge} id=${cls} /> ${finished ? '🏆 Mistrz klasy' : 'Prowadzi'}</div>
          ${top ? html`
            <div class="hof-champ-name"><${DriverLink} driver=${cb.driverById.get(top.driver_id)} /></div>
            <div class="muted small">${car ? `${car.name} · ` : ''}${top.points} pkt · ${top.wins} wygr.</div>
            <${Podium3} rows=${st.drivers} b=${cb} />` : html`<div class="muted small">Brak wyników w tej klasie</div>`}
        </div>`;
      })}
    </div>
  </article>`;
}

function EnduranceCard({ ev, crew, d }) {
  const track = d.trackById.get(ev.track_id);
  return html`<article class="hof-end-card" style=${{ '--cls': carClass(crew.car_class)?.color || 'var(--accent)' }}>
    <div class="hof-end-car">${crew.car_image_url ? html`<img src=${crew.car_image_url} alt="" loading="lazy" />` : html`<span class="hof-end-trophy">🏆</span>`}</div>
    <div class="hof-end-body">
      <div class="eyebrow">${ev.name}${ev.duration_hours ? ` · ${formatHours(ev.duration_hours)}` : ''}</div>
      <div class="hof-end-result">
        ${crew.position_class ? html`<span class=${`pos ${crew.position_class <= 3 ? `pos-${crew.position_class}` : ''}`}>P${crew.position_class}</span> <b>w klasie</b> <${ClassBadge} id=${crew.car_class} />` : html`<${ClassBadge} id=${crew.car_class} />`}
        ${crew.position_overall ? html`<span class="muted">· P${crew.position_overall} ogólnie</span>` : null}
      </div>
      <div><b>${crew.car_number ? `#${crew.car_number} ` : ''}${crew.name}</b>${crew.car_model ? html` <span class="muted">· ${crew.car_model}</span>` : null}</div>
      <div class="hof-end-drivers">${(crew.driver_ids || []).map((id) => html`<${DriverLink} driver=${d.driverById.get(id)} />`)}</div>
      <div class="muted small">${track ? html`<${Flag} code=${track.country_code} size=${14} /> ${track.name} · ` : ''}${ev.start_at ? formatDate(ev.start_at, false) : ''}</div>
    </div>
  </article>`;
}
