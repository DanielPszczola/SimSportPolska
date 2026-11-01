import { useState, useMemo } from '../../vendor/preact-htm.js';
import {
  html, useAsync, loadCurrentBundle, loadSeasonBundle, seasonBase, Loader, SeasonWip, seasonReady, sessionLabel, seriesBase, Flag, TeamTag, DriverLink, PosBadge, Countdown, formatDate, shortDate,
  timeState, raceTimeState, formatHours, streamsFromUrl, watchUrl, youtubeId, StreamLinks, LiveBadge,
} from '../ui.js';
import { computeStandings, carClass, seasonClasses, seasonStyle } from '../scoring.js';
import { classBundle } from './league.js';
import { loadEndurance, ClassBadge } from './endurance.js';
import { loadLobbies, lobbyState, lobbyMeta, loadEvents, activeEvents } from './other.js';
import { loadPosts, Announcements } from './announcements.js';
import { postOnHome } from './signup.js';
import { DotdButton } from './dotd.js';
import { DISCORD_INVITE } from '../config.js';

// logo Discorda (Simple Icons, CC0)
const DISCORD_ICON = 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';

export function HomePage() {
  const data = useAsync(async () => {
    // wszystko równolegle: bieżący sezon F1, bieżący sezon LMU (po jednym zapytaniu), Endurance, open lobby i ogłoszenia
    const [f1, lmu, endurance, lobbies, posts, events] = await Promise.all([loadCurrentBundle('f1'), loadCurrentBundle('lmu'), loadEndurance(), loadLobbies(), loadPosts(), loadEvents()]);
    // trwające wydarzenia „Inne”: kalendarz w nadchodzących, serie dodatkowo z klasyfikacją w bieżących sezonach
    const other = await Promise.all(activeEvents(events).map((e) => loadSeasonBundle(e.season.id)));
    return { f1, lmu, endurance, lobbies, posts, other };
  }, []);
  const d = data.data;
  const news = d ? d.posts.filter((p) => postOnHome(p)) : []; // ogłoszenia z formularzem — do końca zapisów

  return html`
    <section class="hero hero-compact">
      <div class="hero-bg"></div>
      <div class="wrap hero-inner">
        <div class="hero-main">
          <h1 class="hero-title">Sim Sport Polska</h1>
          <p class="hero-tag">F1 · Le Mans Ultimate</p>
        </div>
        <div class="hero-join">
          <span>Dołącz do nas na</span>
          <a class="btn-discord" href=${DISCORD_INVITE} target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d=${DISCORD_ICON} /></svg> Discord
          </a>
        </div>
      </div>
    </section>

    <div class="wrap page">
      ${!d ? html`<${Loader} />` : null}
      ${d ? html`<div class=${`home-grid ${news.length ? 'has-news' : ''}`}>
        <section class="home-col home-up">
          <${Events} d=${d} />
        </section>
        ${news.length ? html`<section class="home-col home-news"><${Announcements} posts=${news} /></section>` : null}
        <section class="home-col home-seasons">
          <div class="page-head"><h2>Bieżące sezony</h2></div>
          ${seasonReady(d.f1) ? html`<${F1Results} b=${d.f1} />` : html`<${WipCard} series="f1" b=${d.f1} />`}
          ${seasonReady(d.lmu) ? html`<${LmuResults} b=${d.lmu} />` : html`<${WipCard} series="lmu" b=${d.lmu} />`}
          ${d.other.filter((b) => b.season.event_format !== 'single').map((b) => (seasonStyle(b.season) === 'lmu'
            ? html`<${LmuResults} key=${b.season.id} b=${b} head=${otherHead(b)} />`
            : html`<${F1Results} key=${b.season.id} b=${b} head=${otherHead(b)} />`))}
        </section>
      </div>` : null}
    </div>
  `;
}

// ---------- nadchodzące wydarzenia (wszystkie serie) ----------

function relative(iso) {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso) - new Date()) / 86400000);
  if (days <= 0) return 'dziś';
  if (days === 1) return 'jutro';
  return `za ${days} dni`;
}

const TYPE = { f1: ['F1', 'Formuła 1'], lmu: ['LMU', 'Liga LMU'], end: ['END', 'Endurance'], lobby: ['LOBBY', 'Open lobby'], inne: ['EVENT', 'Event'] };

/** Sesje ligi / wydarzenia „Inne” w danym stanie czasowym ('upcoming' + bez terminu, albo 'live'). */
function leagueItems(b, type, live) {
  if (!b) return [];
  const now = Date.now();
  const other = b.season.series === 'inne';
  // sprinty to osobne pozycje (weekend sprinterski: sprint, potem wyścig główny)
  return b.sessions
    .filter((r) => {
      const st = raceTimeState(r, now);
      return live ? st === 'live' : st === 'upcoming' || st === 'unscheduled';
    })
    .slice(0, 4)
    .map((r) => {
      const t = b.trackById.get(r.track_id);
      return {
        // kafelek kalendarza jest jeden na rundę (sprint pokazany w kafelku wyścigu głównego)
        key: r.id, type, date: r.race_date, href: `${seasonBase(b.season)}/kalendarz/${(b.races.find((x) => x.round === r.round) || r).id}`,
        // wydarzenie „Inne”: nazwa wydarzenia w tytule (pojedyncze — bez numeru rundy, chyba że to sprint)
        title: other
          ? `${b.season.name}${b.season.event_format === 'single' && r.kind !== 'sprint' ? '' : ` — ${sessionLabel(r)}`}`
          : `${sessionLabel(r)} — ${t?.name ?? 'tor'}`,
        flag: t?.country_code,
        sub: other ? (t?.name ?? 'Tor do ustalenia') : b.season.name,
        classes: other ? (b.season.class_defs || []).map((c) => c.id) : seasonClasses(b.season),
        links: r, race: r, b, // wyścig: głosowanie na kierowcę dnia
      };
    });
}

/** Wszystkie wydarzenia: trwające teraz i nadchodzące (czas trwania minął → znika z obu list, czeka na wyniki). */
function collectEvents(d) {
  const e = d.endurance;
  const now = Date.now();
  const endItem = (ev) => {
    const t = e.trackById.get(ev.track_id);
    const crews = e.crewsOf(ev.id);
    return {
      key: ev.id, type: 'end', date: ev.start_at, href: `#/lmu/endurance/kalendarz/${ev.id}`,
      title: ev.name, flag: t?.country_code,
      sub: [t?.name, ev.duration_hours ? formatHours(ev.duration_hours) : null].filter(Boolean).join(' · '),
      classes: [...new Set(crews.map((c) => c.car_class).filter(Boolean))],
      crews: crews.length, links: streamsFromUrl(ev.stream_url),
    };
  };
  const endState = (ev) => timeState(ev.start_at, (Number(ev.duration_hours) || 2) * 60, now);
  const lobbyItem = (l) => ({ key: l.id, type: 'lobby', date: l.start_at, href: `#/inne/lobby/${l.id}`, title: l.title, sub: lobbyMeta(l) || 'Open lobby', links: l });
  const leagues = (live) => [
    ...leagueItems(d.f1, 'f1', live),
    ...leagueItems(d.lmu, 'lmu', live),
    ...d.other.flatMap((b) => leagueItems(b, 'inne', live)),
  ];
  const byDate = (a, c) => (a.date ? new Date(a.date) : Infinity) - (c.date ? new Date(c.date) : Infinity);
  return {
    live: [
      ...d.lobbies.filter((l) => lobbyState(l, now) === 'live').map(lobbyItem),
      ...leagues(true),
      ...e.upcoming.filter((ev) => endState(ev) === 'live').map(endItem),
    ].sort(byDate),
    upcoming: [
      ...leagues(false),
      ...e.upcoming.filter((ev) => ['upcoming', 'unscheduled'].includes(endState(ev))).map(endItem),
      ...d.lobbies.filter((l) => lobbyState(l, now) === 'scheduled').map(lobbyItem),
    ].sort(byDate).slice(0, 10),
  };
}

function Events({ d }) {
  const { live, upcoming } = collectEvents(d);
  return html`
    ${live.length ? html`<div class="page-head"><h2>Trwa teraz</h2></div>
      <div class="live-list">${live.map((it) => html`<${LiveTile} key=${it.key} it=${it} />`)}</div>` : null}
    <div class="page-head"><h2>Nadchodzące wydarzenia</h2></div>
    <${Upcoming} items=${upcoming} />
  `;
}

/** Trwające wydarzenie: kafelek w proporcjach YouTube, transmisja (wyciszona) w tle i przycisk „Oglądaj”. */
function LiveTile({ it }) {
  const yt = youtubeId(it.links?.youtube_url);
  const watch = watchUrl(it.links);
  return html`<article class=${`live-tile live-${it.type} ${yt ? 'has-video' : ''}`}>
    ${yt ? html`<iframe class="live-bg" tabindex="-1" aria-hidden="true" title="" allow="autoplay; encrypted-media"
      src=${`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&playlist=${yt}&modestbranding=1&rel=0&disablekb=1`}></iframe>` : null}
    <div class="live-shade"></div>
    <div class="live-content">
      <div class="live-top"><${LiveBadge} /><span class=${`up-type up-type-${it.type}`}>${TYPE[it.type][0]}</span><span class="live-kind">${TYPE[it.type][1]}</span></div>
      <h3><a href=${it.href}>${it.title}</a></h3>
      <div class="live-sub"><${Flag} code=${it.flag} size=${16} /> ${it.sub}</div>
      <div class="live-actions">
        <${StreamLinks} links=${it.links} main />
        <${DotdButton} b=${it.b} race=${it.race} />
        ${watch ? null : html`<a class="btn btn-sm" href=${it.href}>Szczegóły →</a>`}
      </div>
    </div>
  </article>`;
}

function Upcoming({ items }) {
  if (!items.length) return html`<div class="empty">Brak zaplanowanych wydarzeń.</div>`;
  const first = items[0];
  const highlight = first.date && new Date(first.date) > new Date();
  const rest = highlight ? items.slice(1) : items; // najbliższe wydarzenie jest w wyróżnionej karcie

  return html`
    ${highlight ? html`<a class="card card-next up-hero" href=${first.href}>
      <div class="eyebrow">Najbliższe wydarzenie · ${TYPE[first.type][1]}</div>
      <h3><${Flag} code=${first.flag} size=${24} /> ${first.title}</h3>
      <div class="muted">${formatDate(first.date)}${first.sub ? ` · ${first.sub}` : ''}</div>
      <${Countdown} to=${first.date} />
    </a>` : null}
    <ul class="up-list">
      ${rest.map((it) => {
        const sd = shortDate(it.date);
        return html`<li><a class=${`up-item up-${it.type}`} href=${it.href}>
          <span class="up-date">${it.date ? html`<b>${sd.day}</b><span>${sd.month}</span>` : html`<span>termin<br />do ust.</span>`}</span>
          <span class="up-body">
            <span class="up-top"><span class=${`up-type up-type-${it.type}`}>${TYPE[it.type][0]}</span> <b>${it.title}</b></span>
            <span class="up-sub muted"><${Flag} code=${it.flag} size=${14} /> ${it.sub}${it.crews ? ` · ${it.crews} ${it.crews === 1 ? 'zespół' : 'zespoły'} SSP` : ''}</span>
            ${it.classes?.length ? html`<span class="up-classes">${it.classes.map((c) => html`<${ClassBadge} id=${c} />`)}</span>` : null}
          </span>
          <span class="up-when">${relative(it.date) ?? ''} →</span>
        </a></li>`;
      })}
    </ul>
  `;
}

// ---------- wyniki bieżących sezonów ----------

const CARD_HEAD = { f1: ['', 'F1', 'Formuła 1'], lmu: ['lmu', 'LMU', 'Liga LMU'] };

/** Karta ligi, której sezon jest dopiero przygotowywany (brak sezonu, kalendarza albo zespołów). */
function WipCard({ series, b }) {
  const [chipClass, chip, title] = CARD_HEAD[series];
  return html`<div class="card home-card">
    <div class="home-card-head">
      <span class=${`series-chip ${chipClass}`}>${chip}</span>
      <div><b>${title}</b>${b ? html` <span class="muted">· ${b.season.name}</span>` : null}</div>
    </div>
    <${SeasonWip} compact />
    <a class="more" href=${`${seriesBase(series)}/kalendarz`}>${series === 'f1' ? 'Sekcja F1' : 'Sekcja Liga LMU'} →</a>
  </div>`;
}

function MiniStandings({ rows, empty }) {
  if (!rows.length) return html`<p class="muted small">${empty}</p>`;
  return html`<ol class="mini-list">${rows}</ol>`;
}

/** Nagłówek karty serii z zakładki „Inne” (zamiast F1 / Liga LMU). */
const otherHead = (b) => ({ chip: 'EVENT', chipClass: 'inne', title: b.season.name, sub: null, href: `${seasonBase(b.season)}/klasyfikacja` });

function F1Results({ b, head }) {
  const st = useMemo(() => computeStandings(b), [b]);
  const h = head || { chip: 'F1', chipClass: '', title: 'Formuła 1', sub: b.season.name, href: '#/f1/klasyfikacja' };
  return html`<div class="card home-card">
    <div class="home-card-head">
      <span class=${`series-chip ${h.chipClass}`}>${h.chip}</span>
      <div><b>${h.title}</b> <span class="muted">· ${h.sub ? `${h.sub} · ` : ''}po ${st.rounds} ${st.rounds === 1 ? 'rundzie' : 'rundach'}</span></div>
    </div>
    <div class="home-card-cols">
      <div>
        <div class="eyebrow">Kierowcy</div>
        <${MiniStandings} empty="Po pierwszym wyścigu." rows=${st.drivers.slice(0, 5).map((dr, i) => html`<li>
          <${PosBadge} pos=${i + 1} /><${DriverLink} driver=${b.driverById.get(dr.driver_id)} /><span class="pts">${dr.points}</span>
        </li>`)} />
      </div>
      <div>
        <div class="eyebrow">${head ? 'Zespoły' : 'Konstruktorzy'}</div>
        <${MiniStandings} empty="Po pierwszym wyścigu." rows=${st.teams.slice(0, 5).map((t, i) => html`<li>
          <${PosBadge} pos=${i + 1} /><${TeamTag} team=${b.teamById.get(t.team_id)} season=${b.season} /><span class="pts">${t.points}</span>
        </li>`)} />
      </div>
    </div>
    <a class="more" href=${h.href}>Pełna klasyfikacja${head ? '' : ' F1'} →</a>
  </div>`;
}

function LmuResults({ b, head }) {
  const classes = seasonClasses(b.season);
  const [cls, setCls] = useState(classes[0]);
  const st = useMemo(() => computeStandings(classBundle(b, cls)), [b, cls]);
  const h = head || { chip: 'LMU', chipClass: 'lmu', title: 'Liga LMU', sub: b.season.name, href: '#/lmu/liga/klasyfikacja' };
  return html`<div class="card home-card">
    <div class="home-card-head">
      <span class=${`series-chip ${h.chipClass}`}>${h.chip}</span>
      <div><b>${h.title}</b>${h.sub ? html` <span class="muted">· ${h.sub}</span>` : null}</div>
    </div>
    ${classes.length > 1 ? html`<div class="home-classes">
      ${classes.map((c) => html`<button class=${`class-pill ${c === cls ? 'active' : ''}`} style=${{ '--cls': carClass(c)?.color }} onClick=${() => setCls(c)}>${carClass(c)?.label}</button>`)}
    </div>` : null}
    <div class="eyebrow">Kierowcy — ${carClass(cls)?.label}</div>
    <${MiniStandings} empty="Klasyfikacja pojawi się po pierwszym wyścigu." rows=${st.drivers.slice(0, 5).map((dr, i) => html`<li>
      <${PosBadge} pos=${i + 1} /><${DriverLink} driver=${b.driverById.get(dr.driver_id)} />
      <span class="hide-sm"><${TeamTag} team=${b.teamById.get(dr.team_id)} season=${b.season} /></span>
      <span class="pts">${dr.points}</span>
    </li>`)} />
    <a class="more" href=${h.href}>Pełna klasyfikacja${head ? '' : ' LMU'} →</a>
  </div>`;
}
