// Wspólny nagłówek sekcji serii (F1, LMU, Inne) i główne zakładki LMU (Liga / Endurance).
import { html } from '../ui.js';

export const SERIES_INFO = {
  f1: { chip: 'F1', title: 'Formuła 1', chipClass: '' },
  lmu: { chip: 'LMU', title: 'Le Mans Ultimate', chipClass: 'lmu' },
  inne: { chip: 'EVENT', title: 'Eventy', chipClass: 'inne' },
};

/** Główne zakładki sekcji LMU: Liga i Endurance. */
export function LmuTopNav({ active }) {
  return html`<nav class="wrap topnav">
    <a href="#/lmu/liga" class=${active === 'liga' ? 'active' : ''}>Liga</a>
    <a href="#/lmu/endurance" class=${active === 'endurance' ? 'active' : ''}>Endurance</a>
  </nav>`;
}

/** Nagłówek sekcji serii (tytuł, opcjonalnie wybór sezonu, zakładki). */
export function SectionHead({ series, right, top, nav, title }) {
  const info = SERIES_INFO[series];
  return html`<div class="section-head">
    <div class="wrap section-head-inner">
      <div class="section-title">
        <span class=${`series-chip ${info.chipClass}`}>${info.chip}</span>
        <h1>${title || info.title}</h1>
      </div>
      ${right}
    </div>
    ${top}
    ${nav}
  </div>`;
}
