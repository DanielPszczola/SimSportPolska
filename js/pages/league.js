import { useState, useMemo, useRef, useEffect } from '../../vendor/preact-htm.js';
import {
  html, useAsync, loadSeasonBundle, listSeasons, pickSeason, rememberSeason,
  seriesBase, unit, Flag, TeamTag, DriverLink, PosBadge, Loader, ErrorBox, Empty, Tabs, Countdown, formatDate, shortDate, SeatCell, driverSeat, TrackMedia, VideoEmbed, youtubeId,
} from '../ui.js';
import { computeRace, computeStandings, penaltyLabel, formatDuration, resultClass, carClass, seasonClasses } from '../scoring.js';
import { TeamsGrid, TeamPage } from './teams.js';
import { bundleLineup, teamSeats } from '../lineup.js';
import { EnduranceSection } from './endurance.js';
import { SERIES_INFO, SectionHead, LmuTopNav } from './section.js';
import { RaceConditions } from '../race-conditions.js';


const subnavFor = (series) => [
  ['klasyfikacja', 'Klasyfikacja'],
  ['wyniki', 'Wyniki'],
  ['kalendarz', 'Kalendarz'],
  [unit(series).listPath, unit(series).many], // F1: Zespoły, LMU: Samochody
];
const isTeamList = (sub) => sub === 'zespoly' || sub === 'samochody';
const isTeamPage = (sub) => sub === 'zespol' || sub === 'samochod';


export { seasonClasses };

/**
 * Widok sezonu zawężony do jednej klasy: tylko wyniki tej klasy, jej zespoły i składy.
 * Dzięki temu klasyfikacje, wyniki, kalendarz i zespoły liczą się osobno dla każdej klasy.
 */
export function classBundle(b, cls) {
  if (!cls) return b;
  const results = b.results.filter((r) => resultClass(r, b.season) === cls);
  const teams = b.teams.filter((t) => t.car_class === cls || results.some((r) => r.team_id === t.id));
  const teamIds = new Set(teams.map((t) => t.id));
  return {
    ...b,
    carClass: cls,
    results,
    teams,
    entries: b.entries.filter((e) => !e.team_id || teamIds.has(e.team_id)),
    rosterChanges: b.rosterChanges.filter((c) => teamIds.has(c.team_id)),
  };
}

const baseOf = (b) => seriesBase(b.season.series);

/** Sekcja ligi (F1 albo LMU): klasyfikacje, wyniki, kalendarz, zespoły; w LMU z podziałem na klasy. */
export function LeagueSection({ series, parts, top }) {
  const info = SERIES_INFO[series];
  const base = seriesBase(series);
  const seasons = useAsync(() => listSeasons(series), [series]);
  const [seasonId, setSeasonId] = useState(null);
  const season = seasons.data && (seasons.data.find((s) => s.id === seasonId) || pickSeason(seasons.data, series));
  const bundle = useAsync(() => (season ? loadSeasonBundle(season.id) : Promise.resolve(null)), [season?.id]);
  const [sub = 'klasyfikacja', arg] = parts;
  const [pickedClass, setPickedClass] = useState(null);
  // stary adres profilu (#/f1/kierowca/:id) -> wspólny profil
  if (sub === 'kierowca' && arg) location.replace(`#/kierowca/${arg}`);

  const classes = seasonClasses(season);
  const cls = classes.includes(pickedClass) ? pickedClass : classes[0] || null;
  const b = bundle.data ? classBundle(bundle.data, cls) : null;
  const changeSeason = (id) => {
    rememberSeason(series, id);
    setSeasonId(id);
  };

  let body;
  if (seasons.loading || bundle.loading) body = html`<${Loader} />`;
  else if (seasons.error || bundle.error) body = html`<${ErrorBox} error=${seasons.error || bundle.error} />`;
  else if (!season) body = html`<${Empty}>Nie utworzono jeszcze żadnego sezonu ${info.title}. Administrator może to zrobić w panelu admina.<//>`;
  else if (sub === 'klasyfikacja') body = html`<${Standings} b=${b} />`;
  else if (sub === 'wyniki') body = html`<${ResultsPage} b=${b} raceId=${arg} />`;
  else if (sub === 'kalendarz') body = html`<${Calendar} b=${b} focusId=${arg} />`;
  else if (isTeamList(sub)) body = html`<${TeamsGrid} b=${b} />`;
  else if (isTeamPage(sub)) body = html`<${TeamPage} teamId=${arg} />`;
  else body = html`<${Empty}>Nie ma takiej podstrony.<//>`;

  const showClassBar = season && classes.length > 1 && !isTeamPage(sub);
  return html`<div class=${`section-${series}`}>
    <${SectionHead} series=${series} top=${top}
      right=${seasons.data?.length ? html`<label class="season-select">
        <span>Sezon</span>
        <select value=${season?.id} onChange=${(e) => changeSeason(e.target.value)}>
          ${seasons.data.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
        </select>
      </label>` : null}
      nav=${html`<nav class="wrap subnav">
        ${subnavFor(series).map(([id, label]) => html`<a href=${`${base}/${id}`} class=${sub === id || (isTeamList(id) && isTeamPage(sub)) ? 'active' : ''}>${label}</a>`)}
      </nav>`} />
    ${showClassBar ? html`<div class="class-bar"><div class="wrap class-bar-inner">
      <span class="muted">Klasa:</span>
      ${classes.map((c) => html`<button class=${`class-pill ${c === cls ? 'active' : ''}`} style=${{ '--cls': carClass(c)?.color }} onClick=${() => setPickedClass(c)}>${carClass(c)?.label ?? c}</button>`)}
    </div></div>` : null}
    ${b ? html`<${NextRaceStrip} b=${b} />` : null}
    <div class="wrap page">${body}</div>
  </div>`;
}

export const F1Section = ({ parts }) => html`<${LeagueSection} series="f1" parts=${parts} />`;

/** Sekcja LMU: główne zakładki Liga (#/lmu/liga/...) i Endurance (#/lmu/endurance/...). */
export function LmuSection({ parts }) {
  const [top, ...rest] = parts;
  if (top === 'endurance') return html`<${EnduranceSection} parts=${rest} />`;
  // stare adresy (#/lmu/klasyfikacja) traktujemy jak #/lmu/liga/klasyfikacja
  const leagueParts = top === 'liga' ? rest : parts;
  return html`<${LeagueSection} series="lmu" parts=${leagueParts} top=${html`<${LmuTopNav} active="liga" />`} />`;
}

export function nextRace(b) {
  return b.races.find((r) => r.status !== 'completed' && new Date(r.race_date) > new Date()) || b.races.find((r) => r.status !== 'completed');
}

function NextRaceStrip({ b }) {
  const race = nextRace(b);
  if (!race) return null;
  const track = b.trackById.get(race.track_id);
  return html`<div class="next-strip">
    <div class="wrap next-strip-inner">
      <div>
        <div class="eyebrow">Następny wyścig · Runda ${race.round}</div>
        <div class="next-name"><${Flag} code=${track?.country_code} /> ${track?.name ?? 'Tor'} <span class="muted">· ${formatDate(race.race_date)}</span></div>
        ${b.season.series === 'lmu' ? html`<${RaceConditions} race=${race} compact />` : null}
      </div>
      ${race.race_date ? html`<${Countdown} to=${race.race_date} />` : null}
    </div>
  </div>`;
}

// ---------- klasyfikacja ----------

function Standings({ b }) {
  const [tab, setTab] = useState('drivers');
  const st = useMemo(() => computeStandings(b), [b]);
  if (!st.races.length) {
    return html`<${Empty}>Klasyfikacja pojawi się po pierwszym rozegranym wyścigu.<//>`;
  }
  return html`
    <div class="page-head">
      <h2>Klasyfikacja${b.carClass ? ` — ${carClass(b.carClass)?.label}` : ''} po ${st.races.length} ${st.races.length === 1 ? 'rundzie' : 'rundach'}</h2>
      <${Tabs} value=${tab} onChange=${setTab} tabs=${[
        { id: 'drivers', label: 'Kierowcy' },
        // w lidze LMU klasyfikacja zespołów nie jest prowadzona
        ...(b.season.series === 'f1' ? [{ id: 'teams', label: 'Konstruktorzy' }] : []),
        { id: 'matrix', label: 'Runda po rundzie' },
      ]} />
    </div>
    ${tab === 'drivers' ? html`<${DriverStandings} b=${b} st=${st} />` : null}
    ${tab === 'teams' && b.season.series === 'f1' ? html`<${TeamStandings} b=${b} st=${st} />` : null}
    ${tab === 'matrix' ? html`<${Matrix} b=${b} st=${st} />` : null}
  `;
}

function Podium({ items }) {
  return html`<div class="podium">
    ${items.map((it, i) => html`<div class=${`podium-card p${i + 1} ${it.car ? 'has-car' : ''}`} style=${{ '--team': it.color || '#888' }}>
      <div class="podium-pos">${i + 1}</div>
      ${it.car ? html`<img class="podium-car" src=${it.car} alt="" loading="lazy" />` : null}
      <div class="podium-name">${it.name}</div>
      <div class="podium-sub">${it.sub}</div>
      <div class="podium-pts"><b>${it.points}</b> pkt</div>
    </div>`)}
  </div>`;
}

function DriverStandings({ b, st }) {
  const leader = st.drivers[0]?.points ?? 0;
  return html`
    <${Podium} items=${st.drivers.slice(0, 3).map((d) => {
      const seat = driverSeat(b, d.driver_id);
      const team = seat.team || b.teamById.get(d.team_id);
      return { name: b.driverById.get(d.driver_id)?.nick ?? '?', sub: seat.reserve ? 'Rezerwa' : team?.name ?? '', color: team?.color, points: d.points };
    })} />
    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th class="c">P</th><th>Kierowca</th><th>${unit(b.season.series).one}</th>
          <th class="c hide-sm" title="Wygrane">Wygr.</th><th class="c hide-sm">Podia</th>
          <th class="c hide-sm" title="Pole position">Pole</th><th class="c hide-sm" title="Najszybsze okrążenia">NO</th>
          <th class="r hide-sm">Strata</th><th class="r">Pkt</th>
        </tr></thead>
        <tbody>
          ${st.drivers.map((d, i) => {
            const seat = driverSeat(b, d.driver_id);
            return html`<tr style=${{ '--team': seat.team?.color || 'transparent' }} class=${`team-row ${seat.reserve ? 'row-reserve' : ''}`}>
              <td class="c"><${PosBadge} pos=${i + 1} /></td>
              <td><${DriverLink} driver=${b.driverById.get(d.driver_id)} /></td>
              <td><${SeatCell} b=${b} driverId=${d.driver_id} teamIds=${d.teamIds} /></td>
              <td class="c hide-sm">${d.wins || '·'}</td>
              <td class="c hide-sm">${d.podiums || '·'}</td>
              <td class="c hide-sm">${d.poles || '·'}</td>
              <td class="c hide-sm">${d.fls || '·'}</td>
              <td class="r muted hide-sm">${i ? `−${leader - d.points}` : '—'}</td>
              <td class="r pts">${d.points}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
}

function TeamStandings({ b, st }) {
  const seats = bundleLineup(b);
  const driversOf = (teamId) => teamSeats(seats, teamId).map((s) => b.driverById.get(s.driver_id)?.nick).filter(Boolean);
  return html`
    <${Podium} items=${st.teams.slice(0, 3).map((t) => {
      const team = b.teamById.get(t.team_id);
      return { name: team?.name ?? '?', sub: driversOf(t.team_id).join(' · '), color: team?.color, points: t.points, car: team?.car_url };
    })} />
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th class="c">P</th><th>Zespół</th><th class="hide-sm">Kierowcy</th><th class="c hide-sm">Wygr.</th><th class="c hide-sm">Podia</th><th class="r">Pkt</th></tr></thead>
        <tbody>
          ${st.teams.map((t, i) => {
            const team = b.teamById.get(t.team_id);
            return html`<tr style=${{ '--team': team?.color || 'transparent' }} class="team-row">
              <td class="c"><${PosBadge} pos=${i + 1} /></td>
              <td><${TeamTag} team=${team} base=${baseOf(b)} /></td>
              <td class="muted hide-sm">${driversOf(t.team_id).join(', ')}</td>
              <td class="c hide-sm">${t.wins || '·'}</td>
              <td class="c hide-sm">${t.podiums || '·'}</td>
              <td class="r pts">${t.points}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
}

function cellClass(c) {
  if (!c) return 'mx-none';
  if (!c.pos) return c.status === 'DNS' ? 'mx-dns' : 'mx-out';
  if (c.pos <= 3) return `mx-p${c.pos}`;
  return c.points > 0 ? 'mx-pts' : 'mx-nopts';
}

function Matrix({ b, st }) {
  const base = baseOf(b);
  return html`
    <div class="table-wrap">
      <table class="table matrix">
        <thead><tr>
          <th class="c">P</th><th class="sticky">Kierowca</th>
          ${st.races.map((r) => {
            const t = b.trackById.get(r.track_id);
            return html`<th class="c" title=${t?.name}><a href=${`${base}/wyniki/${r.id}`}><${Flag} code=${t?.country_code} size=${18} /><small>R${r.round}</small></a></th>`;
          })}
          <th class="r">Pkt</th>
        </tr></thead>
        <tbody>
          ${st.drivers.map((d, i) => html`<tr>
            <td class="c">${i + 1}</td>
            <td class="sticky"><${DriverLink} driver=${b.driverById.get(d.driver_id)} />${driverSeat(b, d.driver_id).reserve ? html`<span class="badge badge-reserve" title="Rezerwa">R</span>` : null}</td>
            ${st.races.map((r) => {
              const c = d.perRound[r.id];
              return html`<td class=${`c mx ${cellClass(c)}`} title=${c ? `${c.points} pkt` : ''}>
                ${c ? (c.pos ?? c.status) : ''}${c?.fl ? html`<sup class="fl-dot" title="Najszybsze okrążenie">●</sup>` : null}
              </td>`;
            })}
            <td class="r pts">${d.points}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    <div class="legend">
      <span><i class="mx-p1"></i>1.</span><span><i class="mx-p2"></i>2.</span><span><i class="mx-p3"></i>3.</span>
      <span><i class="mx-pts"></i>Punkty</span><span><i class="mx-nopts"></i>Bez punktów</span><span><i class="mx-out"></i>DNF / DSQ</span>
      <span><sup class="fl-dot">●</sup> Najszybsze okrążenie</span>
    </div>`;
}

// ---------- wyniki wyścigu ----------

function ResultsPage({ b, raceId }) {
  const done = b.races.filter((r) => r.status === 'completed');
  const race = (raceId && b.races.find((r) => r.id === raceId)) || done[done.length - 1];
  if (!race) return html`<${Empty}>Żaden wyścig nie został jeszcze rozegrany.<//>`;
  const base = baseOf(b);
  return html`
    <div class="round-strip">
      ${b.races.map((r) => {
        const t = b.trackById.get(r.track_id);
        const cls = `${r.id === race.id ? 'active' : ''} ${r.status === 'completed' ? '' : 'future'}`;
        return html`<a href=${`${base}/wyniki/${r.id}`} class=${cls} title=${t?.name}><${Flag} code=${t?.country_code} size=${18} /><span>R${r.round}</span></a>`;
      })}
    </div>
    <${RaceResult} b=${b} race=${race} />`;
}

export function RaceResult({ b, race, compact = false }) {
  const track = b.trackById.get(race.track_id);
  // wyniki publikujemy dopiero po zatwierdzeniu wyścigu w panelu admina
  const published = race.status === 'completed';
  const rows = published ? computeRace(race, b.season, b.results, b.penalties) : [];
  const pens = published ? b.penalties.filter((p) => p.race_id === race.id) : [];
  return html`<section class="race">
    ${compact ? null : html`<div class="race-head">
      <div class="race-round">Runda ${race.round}${b.carClass ? html` · <span class="class-badge" style=${{ '--cls': carClass(b.carClass)?.color }}>${carClass(b.carClass)?.label}</span>` : ''}</div>
      <h2><${Flag} code=${track?.country_code} size=${28} /> ${track?.name ?? 'Tor'}</h2>
      <div class="race-meta">
        <span>📅 ${formatDate(race.race_date)}</span>
        ${track?.length_km ? html`<span>📏 ${track.length_km} km</span>` : null}
        ${race.laps ? html`<span>🔁 ${race.laps} okr.</span>` : null}
        ${race.counts === false ? html`<span class="badge badge-warn">Nie liczy się do klasyfikacji</span>` : null}
      </div>
      ${b.season.series === 'lmu' ? html`<${RaceConditions} race=${race} />` : null}
      ${race.notes ? html`<p class="muted">${race.notes}</p>` : null}
    </div>`}
    ${compact ? null : html`<${TrackMedia} track=${track} />`}
    ${!rows.length ? html`<${Empty}>
      ${race.status === 'completed' ? 'Brak wprowadzonych wyników.' : 'Wyniki pojawią się po wyścigu.'}
      ${race.status !== 'completed' && race.race_date && new Date(race.race_date) > new Date() ? html`<${Countdown} to=${race.race_date} />` : null}
    <//>` : html`<div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th class="c">Poz</th><th class="c hide-sm" title="Zmiana względem startu">+/−</th><th>Kierowca</th><th class="hide-sm">${unit(b.season.series).one}</th>
          <th class="c hide-sm">Start</th><th class="c hide-sm">Pit</th><th class="r hide-sm">Najl. okr.</th>
          <th class="r">Czas / strata</th><th class="r">Pkt</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => {
            const team = b.teamById.get(r.team_id);
            return html`<tr style=${{ '--team': team?.color || 'transparent' }} class="team-row">
              <td class="c"><${PosBadge} pos=${r.finalPos} status=${r.status} /></td>
              <td class="c hide-sm"><${Delta} v=${r.posChange} /></td>
              <td>
                <${DriverLink} driver=${b.driverById.get(r.driver_id)} />
                ${r.hasPole ? html`<span class="badge badge-pole" title="Pole position">P</span>` : null}
                ${r.hasFastestLap ? html`<span class="badge badge-fl" title="Najszybsze okrążenie">NO</span>` : null}
                ${r.penalties.map((p) => html`<span class="badge badge-pen" title=${p.reason}>${penaltyLabel(p)}</span>`)}
              </td>
              <td class="hide-sm"><${TeamTag} team=${team} base=${baseOf(b)} /></td>
              <td class="c hide-sm">${r.grid || '—'}</td>
              <td class="c hide-sm">${r.pit_stops ?? '—'}</td>
              <td class=${`r mono hide-sm ${r.hasFastestLap ? 'fl-text' : ''}`}>${formatDuration(r.best_lap_ms)}</td>
              <td class="r mono">${r.gapText || (r.finalPos ? '' : html`<span class="muted">${r.status}</span>`)}</td>
              <td class="r pts">${r.points || (r.points === 0 ? '·' : '')}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`}
    ${pens.length && !compact ? html`<div class="stewards">
      <h3>⚖️ Decyzje sędziów</h3>
      <ul>
        ${pens.map((p) => html`<li>
          <span class="badge badge-pen">${penaltyLabel(p)}</span>
          <b>${b.driverById.get(p.driver_id)?.nick ?? '?'}</b>
          <span class="muted">— ${p.reason || 'bez uzasadnienia'}</span>
        </li>`)}
      </ul>
    </div>` : null}
  </section>`;
}

function Delta({ v }) {
  if (v == null) return html`<span class="muted">·</span>`;
  if (v === 0) return html`<span class="delta">=</span>`;
  return html`<span class=${`delta ${v > 0 ? 'up' : 'down'}`}>${v > 0 ? '▲' : '▼'}${Math.abs(v)}</span>`;
}

// ---------- kalendarz ----------

function Calendar({ b, focusId }) {
  const stripRef = useRef(null);
  const next = nextRace(b);
  // karuzela startuje na najbliższym wyścigu (albo na ostatniej rundzie zakończonego sezonu)
  const focusIdx = focusId ? b.races.findIndex((r) => r.id === focusId) : -1;
  const startIdx = focusIdx >= 0 ? focusIdx : Math.max(0, next ? b.races.findIndex((r) => r.id === next.id) : b.races.length - 1);
  const [active, setActive] = useState(startIdx);

  const cardAt = (i) => stripRef.current?.children[i];
  const scrollTo = (i, smooth = true) => {
    const strip = stripRef.current;
    const card = cardAt(i);
    if (!strip || !card) return;
    strip.scrollTo({ left: card.offsetLeft - (strip.clientWidth - card.clientWidth) / 2, behavior: smooth ? 'smooth' : 'instant' });
  };
  useEffect(() => {
    setActive(startIdx);
    scrollTo(startIdx, false);
  }, [b.season.id, focusId]);

  // kółko myszy: jeden ruch = jeden kafelek; na pierwszym/ostatnim kafelku kółko przewija dalej stronę
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    let lockUntil = 0;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // przewijanie poziome (gładzik) zostawiamy przeglądarce
      const dir = Math.sign(e.deltaY);
      const target = activeRef.current + dir;
      if (!dir || target < 0 || target >= b.races.length) return;
      e.preventDefault();
      if (Date.now() < lockUntil) return;
      lockUntil = Date.now() + 450;
      activeRef.current = target;
      setActive(target);
      scrollTo(target);
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, [b.season.id, b.races.length]);
  // aktywny kafelek = ten najbliżej środka paska
  const onScroll = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const mid = strip.scrollLeft + strip.clientWidth / 2;
    let best = 0;
    [...strip.children].forEach((c, i) => {
      if (Math.abs(c.offsetLeft + c.clientWidth / 2 - mid) < Math.abs(cardAt(best).offsetLeft + cardAt(best).clientWidth / 2 - mid)) best = i;
    });
    if (best !== active) setActive(best);
  };

  if (!b.races.length) return html`<${Empty}>Kalendarz sezonu nie został jeszcze ułożony.<//>`;

  return html`
    <div class="page-head">
      <h2>Kalendarz — ${b.races.length} rund</h2>
      <div class="cal-nav">
        <button class="btn btn-sm" onClick=${() => scrollTo(Math.max(0, active - 1))} disabled=${active === 0} aria-label="Poprzednia runda">←</button>
        <span class="muted">Runda ${b.races[active]?.round} / ${b.races.length}</span>
        <button class="btn btn-sm" onClick=${() => scrollTo(Math.min(b.races.length - 1, active + 1))} disabled=${active === b.races.length - 1} aria-label="Następna runda">→</button>
      </div>
    </div>
    <div class="round-strip cal-jump">
      ${b.races.map((r, i) => {
        const t = b.trackById.get(r.track_id);
        return html`<button class=${`${i === active ? 'active' : ''} ${r.status === 'completed' ? '' : 'future'}`} onClick=${() => scrollTo(i)} title=${t?.name}>
          <${Flag} code=${t?.country_code} size=${18} /><span>R${r.round}</span>
        </button>`;
      })}
    </div>

    <div class="cal-strip" ref=${stripRef} onScroll=${onScroll}>
      ${b.races.map((r, i) => {
        const t = b.trackById.get(r.track_id);
        const done = r.status === 'completed';
        const winner = done ? computeRace(r, b.season, b.results, b.penalties)[0] : null;
        const isNext = next?.id === r.id;
        return html`<article class=${`cal-tile ${done ? 'done' : ''} ${isNext ? 'next' : ''} ${i === active ? 'active' : ''}`}>
          <header class="cal-tile-head">
            <div class="cal-tile-round">
              <span class="cal-tile-num">R${r.round}</span>
              <span class="muted">${r.race_date ? formatDate(r.race_date) : 'Data do ustalenia'}</span>
            </div>
            <h3><${Flag} code=${t?.country_code} size=${28} /> ${t?.name ?? '—'}</h3>
            <div class="cal-tile-meta muted">${[t?.country, t?.length_km ? `${t.length_km} km` : null, r.laps ? `${r.laps} okr.` : null].filter(Boolean).join(' · ')}</div>
            ${b.season.series === 'lmu' ? html`<${RaceConditions} race=${r} />` : null}
            <div class="cal-tile-status">
              ${isNext ? html`<span class="badge badge-next">Następny wyścig</span>` : null}
              ${done ? html`<span class="badge badge-ok">Rozegrany</span>` : !isNext ? html`<span class="badge">Zaplanowany</span>` : null}
              ${winner?.finalPos === 1 ? html`<span class="cal-winner">🏆 ${b.driverById.get(winner.driver_id)?.nick}</span>` : null}
            </div>
          </header>
          <div class="cal-tile-media">
            <figure class="cal-media-box">
              <figcaption>Nitka toru</figcaption>
              ${t?.layout_url
                ? html`<div class="cal-layout-img"><img src=${t.layout_url} alt=${`Nitka toru ${t.name}`} loading="lazy" /></div>`
                : html`<div class="cal-nodata">Brak danych</div>`}
            </figure>
            <figure class="cal-media-box">
              <figcaption>Film z przejazdu</figcaption>
              ${youtubeId(t?.video_url)
                ? html`<${VideoEmbed} url=${t.video_url} title=${`Przejazd: ${t.name}`} />`
                : html`<div class="cal-nodata">Brak danych</div>`}
            </figure>
          </div>
          <footer class="cal-tile-foot">
            ${isNext && r.race_date && new Date(r.race_date) > new Date() ? html`<${Countdown} to=${r.race_date} />` : html`<span></span>`}
            ${done ? html`<a class="btn btn-sm btn-accent" href=${`${baseOf(b)}/wyniki/${r.id}`}>Wyniki →</a>` : null}
          </footer>
        </article>`;
      })}
    </div>`;
}
