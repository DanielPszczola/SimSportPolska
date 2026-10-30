import { useState, useEffect } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, loadSeasonBundle, sessionLabel, Loader, ErrorBox, Flag, attempt, shortDate } from '../ui.js';
import { isSprint } from '../scoring.js';
import { bundleLineup } from '../lineup.js';
import { SERIES, adminHref } from './common.js';
import { StartPanel, SeasonForm, deleteSeasonCascade } from './start.js';
import { RacePanel } from './race.js';

/** Panel jednej serii (F1 albo LMU): wybór sezonu + oś sezonu. */
export function SeriesAdmin({ series, parts }) {
  const [, seasonParam, tileParam, stepParam] = parts;
  const seasons = useAsync(() => db.list('seasons', { eq: { series }, order: ['created_at', false] }), [series]);
  const [creating, setCreating] = useState(false);

  if (seasons.loading && !seasons.data) return html`<${Loader} />`;
  if (seasons.error) return html`<${ErrorBox} error=${seasons.error} />`;
  const list = seasons.data;
  const season = list.find((s) => s.id === seasonParam) || list.find((s) => s.is_current) || list[0] || null;
  const go = (seasonId, tile, step) => { location.hash = adminHref(series, seasonId, tile, step); };

  const remove = async () => {
    if (!confirm(`Usunąć sezon "${season.name}" razem z kalendarzem, zespołami, składami, wynikami i karami? Tego nie da się cofnąć.`)) return;
    if (await attempt(() => deleteSeasonCascade(season.id), 'Sezon usunięty')) {
      seasons.reload();
      go();
    }
  };

  const form = creating || !season ? html`<div class="card">
    <${SeasonForm} season=${{ series }} onCancel=${season ? () => setCreating(false) : null}
      onSaved=${(s) => { setCreating(false); seasons.reload(); go(s.id, 'start', 'kalendarz'); }} />
  </div>` : null;

  return html`
    <div class="season-bar">
      <div class="season-bar-title">
        <span class="eyebrow">${SERIES[series]}</span>
        ${season ? html`<select class="season-switch" value=${season.id} onChange=${(e) => go(e.target.value)}>
          ${list.map((s) => html`<option value=${s.id}>${s.name}${s.is_current ? ' ★' : ''}</option>`)}
        </select>` : html`<b>Brak sezonów</b>`}
      </div>
      <div class="head-controls">
        <button class="btn btn-accent btn-sm" onClick=${() => setCreating(true)}>+ Nowy sezon</button>
        ${season ? html`<button class="btn btn-sm btn-danger" onClick=${remove}>Usuń sezon</button>` : null}
      </div>
    </div>
    ${form}
    ${season ? html`<${SeasonWorkspace} key=${season.id} season=${season} seasons=${list}
      tile=${tileParam} step=${stepParam} nav=${(tile, step) => go(season.id, tile, step)} onSeasonChanged=${seasons.reload} />` : null}
  `;
}

/** Stan kafelka wyścigu na osi sezonu. */
export function raceState(b, race) {
  if (race.status === 'completed') return 'done';
  if (b.results.some((r) => r.race_id === race.id)) return 'draft';
  return b.sessions.find((r) => r.status !== 'completed')?.id === race.id ? 'next' : 'planned';
}

const STATE_LABEL = { done: 'Zatwierdzony', draft: 'Do zatwierdzenia', next: 'Następny', planned: 'Zaplanowany' };

export function startChecks(b) {
  const seats = bundleLineup(b, 1);
  const regulars = [...seats.values()].filter((s) => s.team_id).length;
  return {
    races: b.races.length,
    teams: b.teams.length,
    regulars,
    reserves: seats.size - regulars,
    ready: b.races.length > 0 && b.teams.length > 0 && regulars > 0,
  };
}

function SeasonWorkspace({ season, seasons, tile, step, nav, onSeasonChanged }) {
  const bundle = useAsync(() => loadSeasonBundle(season.id), [season.id]);
  // przewiń oś sezonu do aktywnego kafelka
  useEffect(() => {
    const el = document.querySelector('.timeline .tile.active');
    const strip = el?.parentElement;
    if (el && strip) strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2 });
  }, [tile, bundle.data]);
  if (bundle.loading && !bundle.data) return html`<${Loader} />`;
  if (bundle.error) return html`<${ErrorBox} error=${bundle.error} />`;
  const b = bundle.data;
  const checks = startChecks(b);
  // oś sezonu: wszystkie sesje — w weekendzie sprinterskim sprint ma osobny kafelek przed wyścigiem głównym
  const openRace = b.sessions.find((r) => r.status !== 'completed');
  const tileId = tile || (checks.ready && openRace ? openRace.id : 'start');
  const race = b.sessions.find((r) => r.id === tileId) || null;
  const reload = () => {
    bundle.reload();
    onSeasonChanged();
  };

  return html`
    <div class="timeline" role="tablist">
      <button role="tab" aria-selected=${!race} class=${`tile tile-start ${!race ? 'active' : ''} ${checks.ready ? 'tile-done' : 'tile-next'}`} onClick=${() => nav('start')}>
        <span class="tile-kicker">Konfiguracja</span>
        <b class="tile-title">Start sezonu</b>
        <span class="tile-meta">${checks.races} wyśc. · ${checks.teams} ${b.season.series === 'lmu' ? 'aut' : 'zesp.'} · ${checks.regulars} kier.</span>
        <span class=${`tile-state ${checks.ready ? 'st-done' : 'st-next'}`}>${checks.ready ? '✓ Gotowe' : 'Do uzupełnienia'}</span>
      </button>
      ${b.sessions.map((r) => {
        const t = b.trackById.get(r.track_id);
        const st = raceState(b, r);
        const d = shortDate(r.race_date);
        const pens = b.penalties.filter((p) => p.race_id === r.id).length;
        const changes = isSprint(r) ? 0 : b.rosterChanges.filter((c) => c.from_round === r.round + 1).length;
        return html`<button role="tab" aria-selected=${race?.id === r.id} class=${`tile ${race?.id === r.id ? 'active' : ''} tile-${st} ${isSprint(r) ? 'tile-sprint' : ''}`} onClick=${() => nav(r.id)}>
          <span class="tile-kicker">${sessionLabel(r)} · ${d.day} ${d.month}</span>
          <b class="tile-title"><${Flag} code=${t?.country_code} size=${18} /> ${t?.name ?? '?'}</b>
          <span class="tile-meta">${pens ? `⚖️ ${pens}` : ''} ${changes ? `🔁 ${changes}` : ''}</span>
          <span class=${`tile-state st-${st}`}>${st === 'done' ? '✓ ' : ''}${STATE_LABEL[st]}</span>
        </button>`;
      })}
      ${!b.races.length ? html`<div class="tile tile-ghost">Dodaj wyścigi w kroku <b>Kalendarz</b>, a pojawią się tutaj.</div>` : null}
    </div>

    ${race
      ? html`<${RacePanel} key=${race.id} b=${b} race=${race} step=${step} nav=${nav} reload=${reload} />`
      : html`<${StartPanel} b=${b} seasons=${seasons} step=${step} nav=${nav} reload=${reload} checks=${checks} />`}
  `;
}
