import { html } from '../vendor/preact-htm.js';

// Warunki ustawione w grze dla wyścigu ligi LMU (ustawienia serwera, NIE termin zawodów):
// pogoda i pora dnia na starcie wyścigu (godzina zegara w grze).

export const WEATHER = [
  { id: 'clear', label: 'Słonecznie', icon: '☀️' },
  { id: 'light_clouds', label: 'Lekkie zachmurzenie', icon: '🌤️' },
  { id: 'partly_cloudy', label: 'Częściowe zachmurzenie', icon: '⛅' },
  { id: 'mostly_cloudy', label: 'Duże zachmurzenie', icon: '🌥️' },
  { id: 'overcast', label: 'Pochmurno', icon: '☁️' },
  { id: 'light_rain', label: 'Lekki deszcz', icon: '🌦️' },
  { id: 'rain', label: 'Deszcz', icon: '🌧️' },
  { id: 'storm', label: 'Burza', icon: '⛈️' },
  { id: 'variable', label: 'Zmienna pogoda', icon: '🔄' },
  { id: 'real', label: 'Rzeczywista pogoda', icon: '🌍' },
];

export const weatherById = (id) => WEATHER.find((w) => w.id === id) || null;

/** Pora dnia z godziny w grze („HH:MM”). */
export function timeOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  if (h >= 5 && h < 7.5) return { label: 'świt', icon: '🌅' };
  if (h >= 7.5 && h < 17.5) return { label: 'dzień', icon: '🌞' };
  if (h >= 17.5 && h < 20.5) return { label: 'zmierzch', icon: '🌇' };
  return { label: 'noc', icon: '🌙' };
}

export const hasConditions = (race) => !!(race?.weather || race?.game_time);

/** Warunki wyścigu w grze: pogoda + pora dnia. */
export function RaceConditions({ race, compact = false }) {
  if (!hasConditions(race)) return null;
  const w = weatherById(race.weather);
  const tod = timeOfDay(race.game_time);
  return html`<div class=${`race-conditions ${compact ? 'compact' : ''}`} title="Ustawienia wyścigu w grze">
    ${compact ? null : html`<span class="race-conditions-label">W grze</span>`}
    ${w ? html`<span class="cond"><span class="cond-icon">${w.icon}</span>${w.label}</span>` : null}
    ${tod ? html`<span class="cond"><span class="cond-icon">${tod.icon}</span>${race.game_time.slice(0, 5)} · ${tod.label}</span>` : null}
  </div>`;
}
