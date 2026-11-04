import { useState, useEffect, useRef, useMemo } from '../../vendor/preact-htm.js';
import { html } from '../ui.js';
import { progressRounds, cumulativePoints, seasonStyle } from '../scoring.js';

// Klasyfikacja → Na przestrzeni sezonu: wykres liniowy punktów narastająco, runda po rundzie (SVG, bez bibliotek).
// Oś X to cały kalendarz, więc linie kończą się na ostatniej rozegranej rundzie.
// Kolor należy do kierowcy / zespołu (--series-1…8), a nie do miejsca w tabeli: wybór innych nie zmienia koloru pozostałych.

const MAX_SERIES = 8; // tyle kolorów przechodzi test czytelności; dziewiątego nie dorabiamy
const DEFAULT_SERIES = 3;
const LABELS_MAX = 4; // przy większej liczbie linii podpisy się zlewają — wystarcza legenda i dymek
const LABEL_GAP = 15;
const TIP_WIDTH = 200; // jak .chart-tip w style.css

/** Czysta skala osi Y: górna wartość i krok (1 / 2 / 5 × 10^n, około 5 podziałek). */
function niceScale(max) {
  if (max <= 0) return { top: 5, step: 1 };
  const rough = max / 5;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  return { top: Math.ceil(max / step) * step, step };
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    setWidth(ref.current.clientWidth);
    const seen = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    seen.observe(ref.current);
    return () => seen.disconnect();
  }, []);
  return [ref, width];
}

export function SeasonChart({ b, st }) {
  const teams = seasonStyle(b.season) === 'f1' && st.teams.length > 0;
  const [mode, setMode] = useState('drivers');
  const { rounds, played } = useMemo(() => progressRounds(b, st), [b, st]);

  const entities = useMemo(() => {
    const list = mode === 'teams'
      ? st.teams.map((t) => ({ id: t.team_id, name: b.teamById.get(t.team_id)?.name ?? '?', points: t.points, of: (id) => t.perRound[id] }))
      : st.drivers.map((d) => ({ id: d.driver_id, name: b.driverById.get(d.driver_id)?.nick ?? '?', points: d.points, of: (id) => d.perRound[id]?.points }));
    return list.map((e) => ({ ...e, values: cumulativePoints(rounds, played, e.of) }));
  }, [mode, st, b, rounds, played]);

  // wybór osobno dla kierowców i zespołów; numer koloru zostaje przy wybranym do końca
  const [picked, setPicked] = useState({});
  const picks = picked[mode] ?? entities.slice(0, DEFAULT_SERIES).map((e, slot) => ({ id: e.id, slot }));
  const setPicks = (list) => setPicked({ ...picked, [mode]: list });
  const add = (id) => {
    const used = new Set(picks.map((p) => p.slot));
    setPicks([...picks, { id, slot: [...Array(MAX_SERIES).keys()].find((s) => !used.has(s)) }]);
  };
  const series = picks.map((p) => ({ ...entities.find((e) => e.id === p.id), slot: p.slot })).filter((s) => s.id);
  const free = entities.filter((e) => !picks.some((p) => p.id === e.id));
  const word = mode === 'teams' ? 'zespół' : 'kierowcę';

  return html`<div class="season-chart">
    ${teams ? html`<div class="seg chart-mode">
      ${[['drivers', 'Kierowcy'], ['teams', 'Konstruktorzy']].map(([id, label]) => html`<button type="button" class=${`btn btn-sm ${mode === id ? 'btn-accent' : ''}`} onClick=${() => setMode(id)}>${label}</button>`)}
    </div>` : null}
    <div class="chart-chips">
      ${series.map((s) => html`<button type="button" class="chart-chip" key=${s.id} title=${`Usuń z wykresu: ${s.name}`} onClick=${() => setPicks(picks.filter((p) => p.id !== s.id))}>
        <i style=${{ background: `var(--series-${s.slot + 1})` }}></i>${s.name} <b>${s.points}</b><span class="muted" aria-hidden="true">✕</span>
      </button>`)}
      ${free.length ? html`<select class="chart-add" value="" disabled=${picks.length >= MAX_SERIES} aria-label=${`Dodaj ${word} do wykresu`} onChange=${(e) => add(e.target.value)}>
        <option value="">${picks.length >= MAX_SERIES ? `Najwyżej ${MAX_SERIES} na wykresie` : `+ Dodaj ${word}`}</option>
        ${free.map((e) => html`<option value=${e.id}>${e.name} · ${e.points} pkt</option>`)}
      </select>` : null}
    </div>
    ${series.length ? html`<${Plot} rounds=${rounds} played=${played} series=${series} b=${b} />` : html`<p class="muted chart-empty">Wybierz ${word}, żeby zobaczyć wykres.</p>`}
    ${series.length ? html`<details class="chart-table">
      <summary>Tabela punktów</summary>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>${mode === 'teams' ? 'Zespół' : 'Kierowca'}</th>${rounds.slice(0, played).map((r) => html`<th class="r">R${r.round}</th>`)}</tr></thead>
        <tbody>${series.map((s) => html`<tr><td>${s.name}</td>${s.values.map((v) => html`<td class="r">${v.total}</td>`)}</tr>`)}</tbody>
      </table></div>
    </details>` : null}
  </div>`;
}

function Plot({ rounds, played, series, b }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null); // indeks rundy pod kursorem
  const narrow = width < 560;
  const labels = !narrow && series.length <= LABELS_MAX;
  const H = narrow ? 260 : 360;
  const M = { top: 14, right: labels ? 118 : 14, bottom: 30, left: 38 };
  const innerW = Math.max(1, width - M.left - M.right);
  const innerH = H - M.top - M.bottom;
  const step = innerW / Math.max(1, rounds.length - 1);
  const totals = series.flatMap((s) => s.values.map((v) => v.total));
  const { top, step: tick } = niceScale(Math.max(0, ...totals));
  const low = Math.min(0, ...totals); // kara punktowa może dać wynik poniżej zera
  const x = (i) => M.left + i * step;
  const y = (v) => M.top + innerH * (1 - (v - low) / (top - low));
  const yTicks = [];
  for (let v = Math.ceil(low / tick) * tick; v <= top; v += tick) yTicks.push(v);
  const every = Math.max(1, Math.ceil(36 / step)); // podpisy osi X nie mogą na siebie wchodzić

  const last = played - 1;
  const onMove = (e) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setHover(Math.min(last, Math.max(0, Math.round((px - M.left) / step))));
  };
  const onKey = (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    setHover((h) => Math.min(last, Math.max(0, (h ?? last) + d)));
  };

  // podpisy na końcach linii: pomijamy te, które weszłyby na sąsiedni (dane są też w legendzie i dymku)
  const ends = [...series].sort((p, q) => q.values[last].total - p.values[last].total);
  let lastY = -Infinity;
  const endLabels = labels ? ends.filter((s) => {
    const py = y(s.values[last].total);
    if (py - lastY < LABEL_GAP) return false;
    lastY = py;
    return true;
  }) : [];

  const r = hover == null ? null : rounds[hover];
  const rows = hover == null ? [] : [...series].sort((p, q) => q.values[hover].total - p.values[hover].total);
  // dymek po stronie z większą ilością miejsca, nigdy poza wykresem
  const tipLeft = hover == null ? 0 : Math.max(0, Math.min(width - TIP_WIDTH, x(hover) < width / 2 ? x(hover) + 12 : x(hover) - 12 - TIP_WIDTH));
  const summary = `Punkty narastająco po ${played} z ${rounds.length} rund: ${ends.map((s) => `${s.name} ${s.values[last].total}`).join(', ')}.`;

  return html`<div class="chart-plot" ref=${ref} style=${{ height: `${H}px` }} tabindex="0" role="img" aria-label=${summary}
    onPointerMove=${onMove} onPointerLeave=${() => setHover(null)} onFocus=${() => setHover(last)} onBlur=${() => setHover(null)} onKeyDown=${onKey}>
    ${width ? html`<svg width=${width} height=${H} aria-hidden="true">
      ${yTicks.map((v) => html`<g>
        <line class="chart-grid" x1=${M.left} x2=${width - M.right} y1=${y(v)} y2=${y(v)} />
        <text class="chart-axis" x=${M.left - 8} y=${y(v) + 4} text-anchor="end">${v}</text>
      </g>`)}
      ${rounds.map((rd, i) => ((rounds.length - 1 - i) % every === 0 ? html`<text class="chart-axis" x=${x(i)} y=${H - 9} text-anchor="middle">R${rd.round}</text>` : null))}
      ${hover != null ? html`<line class="chart-cross" x1=${x(hover)} x2=${x(hover)} y1=${M.top} y2=${M.top + innerH} />` : null}
      ${series.map((s) => html`<polyline class="chart-line" key=${s.id} style=${{ stroke: `var(--series-${s.slot + 1})` }}
        points=${s.values.map((v, i) => `${x(i)},${y(v.total)}`).join(' ')} />`)}
      ${series.map((s) => {
        const at = hover ?? last;
        return html`<circle class="chart-dot" key=${s.id} cx=${x(at)} cy=${y(s.values[at].total)} r="5" style=${{ fill: `var(--series-${s.slot + 1})` }} />`;
      })}
      ${hover == null ? endLabels.map((s) => html`<text class="chart-end" key=${s.id} x=${x(last) + 11} y=${y(s.values[last].total) + 4}>${s.name} <tspan class="chart-end-value">${s.values[last].total}</tspan></text>`) : null}
    </svg>` : null}
    ${r ? html`<div class="chart-tip" style=${{ left: `${tipLeft}px` }}>
      <div class="chart-tip-head">R${r.round} · ${b.trackById.get(r.race.track_id)?.name ?? ''}</div>
      ${rows.map((s) => html`<div class="chart-tip-row" key=${s.id}>
        <i style=${{ background: `var(--series-${s.slot + 1})` }}></i><b>${s.values[hover].total}</b><span>${s.name}</span>
        <span class="muted">${s.values[hover].gain > 0 ? `+${s.values[hover].gain}` : s.values[hover].gain || ''}</span>
      </div>`)}
    </div>` : null}
  </div>`;
}
