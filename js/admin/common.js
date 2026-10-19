import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, attempt } from '../ui.js';
import { prepareImage } from '../images.js';
import { LMU_CLASSES } from '../scoring.js';

export const SERIES = { f1: 'Formuła 1', lmu: 'Le Mans Ultimate' };

/** Adres w panelu: #/admin/<seria>/<sezon>/<kafelek>/<krok> */
export function adminHref(series, seasonId, tile, step) {
  return ['#/admin', series, seasonId, tile, step].filter(Boolean).join('/');
}

export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}

/**
 * Pasek kroków. steps: [{ id, label, state: 'done' | 'todo' | 'warn' | 'info', note }]
 */
export function StepBar({ steps, value, onChange }) {
  return html`<ol class="stepbar">
    ${steps.map((s, i) => html`<li>
      <button class=${`step step-${s.state || 'todo'} ${value === s.id ? 'active' : ''}`} onClick=${() => onChange(s.id)}>
        <span class="step-num">${s.state === 'done' ? '✓' : i + 1}</span>
        <span class="step-text"><b>${s.label}</b>${s.note ? html`<small>${s.note}</small>` : null}</span>
      </button>
    </li>`)}
  </ol>`;
}

/** Przycisk przejścia do kolejnego kroku na dole panelu. */
export function NextStep({ label, onClick }) {
  return html`<div class="next-step"><button class="btn btn-accent" onClick=${onClick}>${label} →</button></div>`;
}

/**
 * Pole grafiki zespołu: podgląd + wgranie pliku ze swojego komputera.
 * Plik jest zmniejszany w przeglądarce i zapisywany w bazie (Supabase Storage / tryb demo).
 * Opcjonalnie: gotowa grafika z katalogu assets/teams albo adres URL.
 */
const IMAGE_TEXT = {
  logo: ['Brak logo', 'PNG z przezroczystym tłem, najlepiej kwadrat'],
  car: ['Brak zdjęcia auta', 'Auto z boku, najlepiej PNG z przezroczystym tłem'],
  track: ['Brak nitki toru', 'Schemat toru, najlepiej PNG z przezroczystym tłem'],
};

export function ImageField({ value, kind, presets = [], onChange }) {
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  // starych plików celowo nie kasujemy: zespół skopiowany z poprzedniego sezonu może używać tego samego pliku,
  // a historia ma pokazywać grafiki z tamtego czasu
  const replace = (url) => onChange(url);
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    await attempt(async () => replace(await db.uploadImage(await prepareImage(file, kind), kind)), 'Grafika wgrana');
    setBusy(false);
  };
  return html`<div class=${`image-field image-${kind}`}>
    <div class="image-preview">${value ? html`<img src=${value} alt="" />` : html`<span>${IMAGE_TEXT[kind][0]}</span>`}</div>
    <div class="image-actions">
      <label class=${`btn btn-sm btn-accent ${busy ? 'disabled' : ''}`}>
        ${busy ? 'Wgrywanie…' : value ? 'Zmień plik' : 'Wgraj plik'}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled=${busy} onChange=${upload} />
      </label>
      ${value ? html`<button type="button" class="btn btn-sm btn-danger" onClick=${() => confirm('Usunąć grafikę?') && replace(null)}>Usuń</button>` : null}
      <button type="button" class="btn btn-sm" onClick=${() => setMore(!more)} title="Gotowe grafiki albo adres URL">⋯</button>
    </div>
    ${more ? html`<div class="image-more">
      ${presets.length ? html`<select value="" onChange=${(e) => e.target.value && replace(e.target.value)}>
        <option value="">— gotowa grafika —</option>
        ${presets.map((p) => html`<option value=${p.url}>${p.label}</option>`)}
      </select>` : null}
      <input placeholder="albo adres URL obrazka" onChange=${(e) => e.target.value.trim() && replace(e.target.value.trim())} />
    </div>` : null}
    <small class="muted">${IMAGE_TEXT[kind][1]}</small>
  </div>`;
}

/** Wybór klasy samochodu; options = lista klas do wyboru (np. klasy sezonu). */
export function ClassSelect({ value, onChange, options }) {
  const list = options ? LMU_CLASSES.filter((c) => options.includes(c.id)) : LMU_CLASSES;
  return html`<select value=${value || ''} onChange=${(e) => onChange(e.target.value || null)} title="Klasa samochodu">
    <option value="">— klasa —</option>
    ${list.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
  </select>`;
}
