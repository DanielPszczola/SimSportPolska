import { useState, useMemo } from '../../vendor/preact-htm.js';
import { html, useAsync, loadCurrentBundle, Loader, SeasonWip, seasonReady, seriesBase, Flag, TeamTag, DriverLink, PosBadge, Countdown, formatDate, shortDate } from '../ui.js';
import { computeStandings, carClass, seasonClasses } from '../scoring.js';
import { classBundle } from './league.js';
import { loadEndurance, ClassBadge } from './endurance.js';

export function HomePage() {
  const data = useAsync(async () => {
    // wszystko równolegle: bieżący sezon F1, bieżący sezon LMU (po jednym zapytaniu) i Endurance
    const [f1, lmu, endurance] = await Promise.all([loadCurrentBundle('f1'), loadCurrentBundle('lmu'), loadEndurance()]);
    return { f1, lmu, endurance };
  }, []);
  const d = data.data;

  return html`
    <section class="hero hero-compact">
      <div class="hero-bg"></div>
      <div class="wrap hero-inner">
        <h1 class="hero-title">Sim Sport Polska</h1>
        <p class="hero-tag">F1 · Le Mans Ultimate</p>
      </div>
    </section>

    <div class="wrap page">
      ${!d ? html`<${Loader} />` : null}
      ${d ? html`<div class="home-grid">
        <section class="home-col">
          <div class="page-head"><h2>Nadchodzące wydarzenia</h2></div>
          <${Upcoming} d=${d} />
        </section>
        <section class="home-col">
          <div class="page-head"><h2>Bieżące sezony</h2></div>
          ${seasonReady(d.f1) ? html`<${F1Results} b=${d.f1} />` : html`<${WipCard} series="f1" b=${d.f1} />`}
          ${seasonReady(d.lmu) ? html`<${LmuResults} b=${d.lmu} />` : html`<${WipCard} series="lmu" b=${d.lmu} />`}
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

function leagueItems(b, series, type) {
  if (!b) return [];
  const now = new Date();
  return b.races
    .filter((r) => r.status !== 'completed' && (!r.race_date || new Date(r.race_date) > now))
    .slice(0, 3)
    .map((r) => {
      const t = b.trackById.get(r.track_id);
      return {
        key: r.id, type, date: r.race_date, href: `${seriesBase(series)}/kalendarz/${r.id}`,
        title: `Runda ${r.round} — ${t?.name ?? 'tor'}`, flag: t?.country_code,
        sub: b.season.name, classes: seasonClasses(b.season),
      };
    });
}

function Upcoming({ d }) {
  const e = d.endurance;
  const items = [
    ...leagueItems(d.f1, 'f1', 'f1'),
    ...leagueItems(d.lmu, 'lmu', 'lmu'),
    ...e.upcoming.map((ev) => {
      const t = e.trackById.get(ev.track_id);
      const crews = e.crewsOf(ev.id);
      return {
        key: ev.id, type: 'end', date: ev.start_at, href: `#/lmu/endurance/kalendarz/${ev.id}`,
        title: ev.name, flag: t?.country_code,
        sub: [t?.name, ev.duration_hours ? `${Number(ev.duration_hours)} h` : null].filter(Boolean).join(' · '),
        classes: [...new Set(crews.map((c) => c.car_class).filter(Boolean))],
        crews: crews.length,
      };
    }),
  ].sort((a, c) => (a.date ? new Date(a.date) : Infinity) - (c.date ? new Date(c.date) : Infinity)).slice(0, 10);

  if (!items.length) return html`<div class="empty">Brak zaplanowanych wydarzeń.</div>`;
  const TYPE = { f1: ['F1', 'Formuła 1'], lmu: ['LMU', 'Liga LMU'], end: ['END', 'Endurance'] };
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

function F1Results({ b }) {
  const st = useMemo(() => computeStandings(b), [b]);
  return html`<div class="card home-card">
    <div class="home-card-head">
      <span class="series-chip">F1</span>
      <div><b>Formuła 1</b> <span class="muted">· ${b.season.name} · po ${st.races.length} rundach</span></div>
    </div>
    <div class="home-card-cols">
      <div>
        <div class="eyebrow">Kierowcy</div>
        <${MiniStandings} empty="Po pierwszym wyścigu." rows=${st.drivers.slice(0, 5).map((dr, i) => html`<li>
          <${PosBadge} pos=${i + 1} /><${DriverLink} driver=${b.driverById.get(dr.driver_id)} /><span class="pts">${dr.points}</span>
        </li>`)} />
      </div>
      <div>
        <div class="eyebrow">Konstruktorzy</div>
        <${MiniStandings} empty="Po pierwszym wyścigu." rows=${st.teams.slice(0, 5).map((t, i) => html`<li>
          <${PosBadge} pos=${i + 1} /><${TeamTag} team=${b.teamById.get(t.team_id)} /><span class="pts">${t.points}</span>
        </li>`)} />
      </div>
    </div>
    <a class="more" href="#/f1/klasyfikacja">Pełna klasyfikacja F1 →</a>
  </div>`;
}

function LmuResults({ b }) {
  const classes = seasonClasses(b.season);
  const [cls, setCls] = useState(classes[0]);
  const st = useMemo(() => computeStandings(classBundle(b, cls)), [b, cls]);
  return html`<div class="card home-card">
    <div class="home-card-head">
      <span class="series-chip lmu">LMU</span>
      <div><b>Liga LMU</b> <span class="muted">· ${b.season.name}</span></div>
    </div>
    ${classes.length > 1 ? html`<div class="home-classes">
      ${classes.map((c) => html`<button class=${`class-pill ${c === cls ? 'active' : ''}`} style=${{ '--cls': carClass(c)?.color }} onClick=${() => setCls(c)}>${carClass(c)?.label}</button>`)}
    </div>` : null}
    <div class="eyebrow">Kierowcy — ${carClass(cls)?.label}</div>
    <${MiniStandings} empty="Klasyfikacja pojawi się po pierwszym wyścigu." rows=${st.drivers.slice(0, 5).map((dr, i) => html`<li>
      <${PosBadge} pos=${i + 1} /><${DriverLink} driver=${b.driverById.get(dr.driver_id)} />
      <span class="hide-sm"><${TeamTag} team=${b.teamById.get(dr.team_id)} base=${seriesBase('lmu')} /></span>
      <span class="pts">${dr.points}</span>
    </li>`)} />
    <a class="more" href="#/lmu/liga/klasyfikacja">Pełna klasyfikacja LMU →</a>
  </div>`;
}
