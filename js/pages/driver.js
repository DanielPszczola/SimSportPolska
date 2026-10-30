import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, seriesBase, useAsync, loadSeasonBundle, Flag, TeamTag, PosBadge, Loader, ErrorBox, Empty, formatDate } from '../ui.js';
import { computeRaceByClass, CAR_CLASSES, carClass } from '../scoring.js';

// Profil kierowcy — wspólny dla wszystkich serii (F1 i LMU), ze statystykami w podziale na klasy.
export function DriverPage({ driverId }) {
  const data = useAsync(async () => {
    const seasons = await db.list('seasons', { order: ['created_at'] });
    return Promise.all(seasons.map((s) => loadSeasonBundle(s.id)));
  }, [driverId]);
  const [cls, setCls] = useState('ALL');

  let body;
  let driver = null;
  if (data.loading) body = html`<${Loader} />`;
  else if (data.error) body = html`<${ErrorBox} error=${data.error} />`;
  else {
    driver = data.data[0]?.driverById.get(driverId) ?? null;
    body = driver
      ? html`<${Profile} bundles=${data.data} driverId=${driverId} cls=${cls} setCls=${setCls} />`
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

function collectHistory(bundles, driverId) {
  const history = [];
  for (const b of bundles) {
    for (const race of b.races.filter((r) => r.status === 'completed')) {
      const row = computeRaceByClass(race, b.season, b.results, b.penalties).find((r) => r.driver_id === driverId);
      if (row) history.push({ b, race, row });
    }
  }
  return history.sort((x, y) => new Date(x.race.race_date || 0) - new Date(y.race.race_date || 0));
}

function summarize(items) {
  const finished = items.filter((h) => h.row.classPos);
  return {
    starts: items.length,
    points: items.reduce((s, h) => s + h.row.points, 0),
    wins: finished.filter((h) => h.row.classPos === 1).length,
    podiums: finished.filter((h) => h.row.classPos <= 3).length,
    poles: items.filter((h) => h.row.hasPole).length,
    fls: items.filter((h) => h.row.hasFastestLap).length,
    dnfs: items.filter((h) => h.row.status !== 'FIN').length,
    best: finished.length ? Math.min(...finished.map((h) => h.row.classPos)) : null,
    avg: finished.length ? (finished.reduce((s, h) => s + h.row.classPos, 0) / finished.length).toFixed(1) : null,
  };
}

function ClassBadge({ id }) {
  const c = carClass(id);
  if (!c) return html`<span class="badge">?</span>`;
  return html`<span class="class-badge" style=${{ '--cls': c.color }}>${c.id}</span>`;
}

function Profile({ bundles, driverId, cls, setCls }) {
  const history = collectHistory(bundles, driverId);
  const byClass = Object.fromEntries(CAR_CLASSES.map((c) => [c.id, summarize(history.filter((h) => h.row.carClass === c.id))]));
  const filtered = cls === 'ALL' ? history : history.filter((h) => h.row.carClass === cls);
  const s = summarize(filtered);
  const inClass = cls !== 'ALL';

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

  return html`
    <div class="class-chips" role="tablist">
      <button role="tab" aria-selected=${cls === 'ALL'} class=${`class-chip ${cls === 'ALL' ? 'active' : ''}`} onClick=${() => setCls('ALL')}>
        <b>Wszystkie</b><span>${history.length} startów</span>
      </button>
      ${CAR_CLASSES.map((c) => {
        const n = byClass[c.id].starts;
        return html`<button role="tab" aria-selected=${cls === c.id} disabled=${!n}
          class=${`class-chip ${cls === c.id ? 'active' : ''}`} style=${{ '--cls': c.color }} onClick=${() => setCls(c.id)}>
          <b>${c.label}</b><span>${n ? `${n} ${n === 1 ? 'start' : 'startów'}` : 'brak startów'}</span>
        </button>`;
      })}
    </div>

    <div class="stat-grid">${stats.map(([l, v]) => html`<div class="stat"><b>${v}</b><span>${l}</span></div>`)}</div>
    ${!inClass && Object.values(byClass).filter((x) => x.starts).length > 1 ? html`<p class="hint">Pozycje, wygrane i podia liczone są w obrębie klasy.</p>` : null}

    <h3>Podział na klasy</h3>
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th>Klasa</th><th class="c">Starty</th><th class="c">Wygr.</th><th class="c">Podia</th>
        <th class="c hide-sm">Pole</th><th class="c hide-sm">NO</th><th class="c hide-sm">Najl.</th><th class="c hide-sm">Śr.</th><th class="r">Pkt</th>
      </tr></thead>
      <tbody>
        ${CAR_CLASSES.map((c) => {
          const x = byClass[c.id];
          return html`<tr class=${x.starts ? '' : 'row-dim'} style=${{ '--team': c.color }}>
            <td><span class="class-name"><${ClassBadge} id=${c.id} /> ${c.label}</span></td>
            <td class="c">${x.starts}</td>
            <td class="c">${x.wins || '·'}</td>
            <td class="c">${x.podiums || '·'}</td>
            <td class="c hide-sm">${x.poles || '·'}</td>
            <td class="c hide-sm">${x.fls || '·'}</td>
            <td class="c hide-sm">${x.best ?? '—'}</td>
            <td class="c hide-sm">${x.avg ?? '—'}</td>
            <td class="r pts">${x.points}</td>
          </tr>`;
        })}
      </tbody>
    </table></div>

    <h3>Historia wyścigów${inClass ? ` — ${carClass(cls).label}` : ''}</h3>
    ${!filtered.length ? html`<${Empty}>Brak rozegranych wyścigów.<//>` : html`<div class="table-wrap"><table class="table">
      <thead><tr>
        <th class="hide-sm">Data</th><th>Sezon</th><th class="c">Klasa</th><th>Tor</th><th class="hide-sm">Zespół / auto</th>
        <th class="c">Start</th><th class="c" title="Pozycja w klasie">Meta</th><th class="r">Pkt</th>
      </tr></thead>
      <tbody>
        ${filtered.slice().reverse().map(({ b, race, row }) => {
          const t = b.trackById.get(race.track_id);
          const track = html`<${Flag} code=${t?.country_code} size=${18} /> ${t?.name ?? '?'}`;
          return html`<tr>
            <td class="muted hide-sm nowrap">${formatDate(race.race_date, false)}</td>
            <td class="muted">${b.season.name} · R${race.round}</td>
            <td class="c"><${ClassBadge} id=${row.carClass} /></td>
            <td><a href=${`${seriesBase(b.season.series)}/wyniki/${race.id}`}>${track}</a></td>
            <td class="hide-sm"><${TeamTag} team=${b.teamById.get(row.team_id)} base=${seriesBase(b.season.series)} /></td>
            <td class="c">${row.grid || '—'}</td>
            <td class="c"><${PosBadge} pos=${row.classPos} status=${row.status} /></td>
            <td class="r pts">${row.points}</td>
          </tr>`;
        })}
      </tbody>
    </table></div>`}
  `;
}
