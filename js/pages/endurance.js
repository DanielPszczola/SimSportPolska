import { useEffect, useRef } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, cached, Loader, ErrorBox, Empty, Flag, DriverLink, Countdown, formatDate, formatHours, VideoEmbed, youtubeId, timeState, LiveBadge } from '../ui.js';
import { carClass } from '../scoring.js';
import { SectionHead, LmuTopNav } from './section.js';

// LMU Endurance: wyścigi długodystansowe, w których jadą zespoły Sim Sport Polska (w barwach ligi).
// Adresy: #/lmu/endurance/kalendarz[/<event>]  i  #/lmu/endurance/wyniki[/<event>]

const CLASS_ORDER = ['HY', 'LMP', 'GT3'];

export const loadEndurance = () => cached('endurance', fetchEndurance);

async function fetchEndurance() {
  const [events, crews, tracks, drivers] = await Promise.all([
    db.list('endurance_events', { order: ['start_at'] }),
    db.list('endurance_crews', { order: ['created_at'] }),
    db.list('tracks'),
    db.list('drivers'),
  ]);
  const byStart = (a, c) => new Date(a.start_at || 0) - new Date(c.start_at || 0);
  return {
    upcoming: events.filter((e) => e.status !== 'finished').sort(byStart),
    finished: events.filter((e) => e.status === 'finished').sort((a, c) => byStart(c, a)),
    // zespoły w kolejności klas: Hypercar, LMP, GT3
    crewsOf: (id) => crews.filter((c) => c.event_id === id).sort((a, c) => CLASS_ORDER.indexOf(a.car_class) - CLASS_ORDER.indexOf(c.car_class) || a.name.localeCompare(c.name)),
    tracks,
    trackById: new Map(tracks.map((t) => [t.id, t])),
    driverById: new Map(drivers.map((d) => [d.id, d])),
  };
}

const SUBNAV = [['kalendarz', 'Kalendarz'], ['wyniki', 'Wyniki']];

export function EnduranceSection({ parts }) {
  const [sub = 'kalendarz', focusId] = parts;
  const data = useAsync(loadEndurance, []);
  const tab = SUBNAV.some(([id]) => id === sub) ? sub : 'kalendarz';

  let body;
  if (data.loading) body = html`<${Loader} />`;
  else if (data.error) body = html`<${ErrorBox} error=${data.error} />`;
  else {
    const d = data.data;
    const list = tab === 'kalendarz' ? d.upcoming : d.finished;
    body = html`
      <div class="page-head"><h2>${tab === 'kalendarz' ? 'Kalendarz wyścigów długodystansowych' : 'Wyniki wyścigów długodystansowych'}</h2></div>
      <p class="muted">Zespoły Sim Sport Polska w wyścigach długodystansowych Le Mans Ultimate — wszystkie auta jadą w barwach ligi.
        Przy każdym evencie znajdziesz nitkę toru, a w kafelku zespołu — film z przejazdu autem jego klasy.</p>
      ${list.length
        ? html`<div class="end-list">${list.map((ev) => html`<${EnduranceEvent} key=${ev.id} ev=${ev} d=${d} focused=${ev.id === focusId} />`)}</div>`
        : html`<${Empty}>${tab === 'kalendarz' ? 'Brak zaplanowanych wyścigów długodystansowych.' : 'Wyniki pojawią się po pierwszym zakończonym evencie.'}<//>`}
    `;
  }

  return html`<div class="section-lmu">
    <${SectionHead} series="lmu" top=${html`<${LmuTopNav} active="endurance" />`}
      nav=${html`<nav class="wrap subnav">${SUBNAV.map(([id, label]) => html`<a href=${`#/lmu/endurance/${id}`} class=${tab === id ? 'active' : ''}>${label}</a>`)}</nav>`} />
    <div class="wrap page">${body}</div>
  </div>`;
}

const hours = (h) => (h ? formatHours(h) : null);

export function ClassBadge({ id }) {
  const c = carClass(id);
  return c ? html`<span class="class-badge" style=${{ '--cls': c.color }}>${c.label}</span>` : null;
}

function CrewResult({ crew }) {
  if (!crew.result_status && !crew.position_class) return html`<div class="crew-result muted">Wynik jeszcze niewprowadzony</div>`;
  if (crew.result_status && crew.result_status !== 'FIN') return html`<div class="crew-result"><span class="pos pos-out">${crew.result_status}</span>${crew.result_note ? html` <span class="muted">${crew.result_note}</span>` : null}</div>`;
  return html`<div class="crew-result">
    ${crew.position_class ? html`<span class=${`pos ${crew.position_class <= 3 ? `pos-${crew.position_class}` : ''}`}>P${crew.position_class}</span> <b>w klasie</b>` : null}
    ${crew.position_overall ? html`<span class="muted">· P${crew.position_overall} ogólnie</span>` : null}
    ${crew.laps ? html`<span class="muted">· ${crew.laps} okr.</span>` : null}
    ${crew.hall_of_fame ? html`<a class="badge badge-hof" href="#/galeria" title="Wynik w Galerii sław">🏆 Galeria sław</a>` : null}
    ${crew.result_note ? html`<div class="muted small">${crew.result_note}</div>` : null}
  </div>`;
}

/** Wersja toru dla klasy auta — każda klasa ma osobny wpis toru (własna nitka i film z przejazdu). */
const trackFor = (d, base, cls) => (base && d.tracks.find((x) => x.name === base.name && x.category === cls)) || null;

/** Jedna nitka toru dla eventu: tor przypisany do eventu, a gdy nie ma nitki — pierwsza wersja z nitką. */
function eventLayout(d, ev) {
  const base = d.trackById.get(ev.track_id);
  if (!base || base.layout_url) return base || null;
  return CLASS_ORDER.map((c) => trackFor(d, base, c)).find((t) => t?.layout_url) || base;
}

export function CrewCard({ crew, d, showResult, video }) {
  return html`<div class="crew-card" style=${{ '--cls': carClass(crew.car_class)?.color || 'var(--accent)' }}>
    <div class="crew-car">
      ${crew.car_image_url ? html`<img src=${crew.car_image_url} alt=${crew.car_model || crew.name} loading="lazy" />` : html`<div class="cal-nodata">Brak zdjęcia auta</div>`}
    </div>
    <div class="crew-body">
      <div class="crew-title">
        ${crew.car_number ? html`<span class="crew-num">#${crew.car_number}</span>` : null}
        <b>${crew.name}</b>
        <${ClassBadge} id=${crew.car_class} />
      </div>
      ${crew.car_model ? html`<div class="muted">${crew.car_model}</div>` : null}
      <ul class="crew-drivers">
        ${(crew.driver_ids || []).map((id) => html`<li><${DriverLink} driver=${d.driverById.get(id)} /></li>`)}
        ${!crew.driver_ids?.length ? html`<li class="muted">Skład do ustalenia</li>` : null}
      </ul>
      ${youtubeId(video?.video_url) ? html`<div class="crew-video">
        <span class="field-label">Przejazd${carClass(crew.car_class) ? ` — ${carClass(crew.car_class).label}` : ''}</span>
        <${VideoEmbed} url=${video.video_url} title=${`${video.name}${carClass(crew.car_class) ? ` — ${carClass(crew.car_class).label}` : ''}`} />
      </div>` : null}
      ${showResult ? html`<${CrewResult} crew=${crew} />` : null}
    </div>
  </div>`;
}

export function EnduranceEvent({ ev, d, focused = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start' });
  }, [focused]);
  const track = d.trackById.get(ev.track_id);
  const layout = eventLayout(d, ev);
  const crews = d.crewsOf(ev.id);
  const finished = ev.status === 'finished';
  const future = ev.start_at && new Date(ev.start_at) > new Date();
  const live = !finished && timeState(ev.start_at, (Number(ev.duration_hours) || 2) * 60) === 'live';
  return html`<article ref=${ref} class=${`end-event ${finished ? 'finished' : ''} ${focused ? 'focused' : ''}`} id=${`event-${ev.id}`}>
    <header class="end-head">
      <div>
        <div class="eyebrow">${finished ? 'Zakończony' : live ? html`<${LiveBadge} />` : 'Endurance'}${hours(ev.duration_hours) ? ` · ${hours(ev.duration_hours)}` : ''}</div>
        <h3>${ev.name}</h3>
        <div class="end-meta">
          ${track ? html`<span><${Flag} code=${track.country_code} size=${18} /> ${track.name}</span>` : null}
          <span>📅 ${ev.start_at ? formatDate(ev.start_at) : 'Termin do ustalenia'}</span>
          <span>🏁 ${crews.length} ${crews.length === 1 ? 'zespół' : crews.length < 5 && crews.length > 1 ? 'zespoły' : 'zespołów'} SSP</span>
        </div>
      </div>
      <div class="end-actions">
        ${!finished && future ? html`<${Countdown} to=${ev.start_at} />` : null}
        ${ev.stream_url ? html`<a class="btn btn-accent" href=${ev.stream_url} target="_blank" rel="noopener">▶ ${finished ? 'Powtórka' : live ? 'Oglądaj' : 'Oglądaj na żywo'}</a>` : null}
      </div>
    </header>
    ${ev.notes ? html`<p class="muted end-notes">${ev.notes}</p>` : null}
    <div class="end-body">
      <figure class="end-layout">
        <figcaption>Nitka toru${layout ? ` — ${layout.name}` : ''}</figcaption>
        ${layout?.layout_url
          ? html`<div class="end-layout-img"><img src=${layout.layout_url} alt=${`Nitka toru ${layout.name}`} loading="lazy" /></div>`
          : html`<div class="cal-nodata">${layout ? 'Brak nitki toru' : 'Tor do ustalenia'}</div>`}
      </figure>
      <div class="crew-grid">
        ${crews.map((c) => html`<${CrewCard} key=${c.id} crew=${c} d=${d} showResult=${finished} video=${trackFor(d, track, c.car_class)} />`)}
        ${!crews.length ? html`<p class="muted">Zespoły zostaną ogłoszone wkrótce.</p>` : null}
      </div>
    </div>
  </article>`;
}
