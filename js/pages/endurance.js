import { useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, Empty, Flag, DriverLink, Countdown, formatDate, VideoEmbed, youtubeId } from '../ui.js';
import { carClass } from '../scoring.js';
import { SectionHead, LmuTopNav } from './section.js';

// LMU Endurance: wyścigi długodystansowe, w których jadą zespoły Sim Sport Polska (w barwach ligi).
// Adresy: #/lmu/endurance/kalendarz[/<event>]  i  #/lmu/endurance/wyniki[/<event>]

const CLASS_ORDER = ['HY', 'LMP', 'GT3'];

export async function loadEndurance() {
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
        Rozwiń event, aby zobaczyć nitkę toru i przejazd w klasie każdego zespołu.</p>
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

const hours = (h) => (h ? `${Number(h)} h` : null);

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
    ${crew.result_note ? html`<div class="muted small">${crew.result_note}</div>` : null}
  </div>`;
}

export function CrewCard({ crew, d, showResult }) {
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
      ${showResult ? html`<${CrewResult} crew=${crew} />` : null}
    </div>
  </div>`;
}

/** Szczegóły toru w wersji dla każdej klasy jadącej w evencie (każda klasa ma osobny wpis toru z własną nitką i filmem). */
function TrackPerClass({ ev, crews, d }) {
  const base = d.trackById.get(ev.track_id);
  if (!base) return html`<p class="muted">Tor nie został jeszcze wybrany.</p>`;
  const classes = CLASS_ORDER.filter((c) => crews.some((x) => x.car_class === c));
  if (!classes.length) return html`<p class="muted">Szczegóły pojawią się po ogłoszeniu zespołów.</p>`;
  return html`<div class="end-details-list">
    ${classes.map((cls) => {
      const t = d.tracks.find((x) => x.name === base.name && x.category === cls);
      const teamNames = crews.filter((x) => x.car_class === cls).map((x) => x.name).join(', ');
      return html`<div class="end-detail" style=${{ '--cls': carClass(cls)?.color }}>
        <div class="end-detail-head"><${ClassBadge} id=${cls} /> <span class="muted">${teamNames}</span></div>
        <div class="cal-tile-media">
          <figure class="cal-media-box">
            <figcaption>Nitka toru — ${carClass(cls)?.label}</figcaption>
            ${t?.layout_url ? html`<div class="cal-layout-img"><img src=${t.layout_url} alt=${`Nitka toru ${t.name}`} loading="lazy" /></div>` : html`<div class="cal-nodata">Brak danych</div>`}
          </figure>
          <figure class="cal-media-box">
            <figcaption>Przejazd — ${carClass(cls)?.label}</figcaption>
            ${youtubeId(t?.video_url) ? html`<${VideoEmbed} url=${t.video_url} title=${`${t.name} — ${carClass(cls)?.label}`} />` : html`<div class="cal-nodata">Brak danych</div>`}
          </figure>
        </div>
      </div>`;
    })}
  </div>`;
}

export function EnduranceEvent({ ev, d, focused = false }) {
  const [open, setOpen] = useState(focused);
  const ref = useRef(null);
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: 'start' });
  }, [focused]);
  const track = d.trackById.get(ev.track_id);
  const crews = d.crewsOf(ev.id);
  const finished = ev.status === 'finished';
  const future = ev.start_at && new Date(ev.start_at) > new Date();
  return html`<article ref=${ref} class=${`end-event ${finished ? 'finished' : ''} ${focused ? 'focused' : ''}`} id=${`event-${ev.id}`}>
    <header class="end-head">
      <div>
        <div class="eyebrow">${finished ? 'Zakończony' : 'Endurance'}${hours(ev.duration_hours) ? ` · ${hours(ev.duration_hours)}` : ''}</div>
        <h3>${ev.name}</h3>
        <div class="end-meta">
          ${track ? html`<span><${Flag} code=${track.country_code} size=${18} /> ${track.name}</span>` : null}
          <span>📅 ${ev.start_at ? formatDate(ev.start_at) : 'Termin do ustalenia'}</span>
          <span>🏁 ${crews.length} ${crews.length === 1 ? 'zespół' : crews.length < 5 && crews.length > 1 ? 'zespoły' : 'zespołów'} SSP</span>
        </div>
      </div>
      <div class="end-actions">
        ${!finished && future ? html`<${Countdown} to=${ev.start_at} />` : null}
        ${ev.stream_url ? html`<a class="btn btn-accent" href=${ev.stream_url} target="_blank" rel="noopener">▶ ${finished ? 'Powtórka' : 'Oglądaj na żywo'}</a>` : null}
      </div>
    </header>
    ${ev.notes ? html`<p class="muted end-notes">${ev.notes}</p>` : null}
    <div class="crew-grid">
      ${crews.map((c) => html`<${CrewCard} crew=${c} d=${d} showResult=${finished} />`)}
      ${!crews.length ? html`<p class="muted">Zespoły zostaną ogłoszone wkrótce.</p>` : null}
    </div>
    <button class="end-toggle" onClick=${() => setOpen(!open)} aria-expanded=${open}>
      ${open ? '▲ Ukryj szczegóły toru' : '▼ Szczegóły: nitka toru i przejazd w klasie każdego zespołu'}
    </button>
    ${open ? html`<div class="end-details"><${TrackPerClass} ev=${ev} crews=${crews} d=${d} /></div>` : null}
  </article>`;
}
