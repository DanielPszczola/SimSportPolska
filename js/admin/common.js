import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, attempt } from '../ui.js';
import { prepareImage } from '../images.js';
import { LMU_CLASSES, carClass } from '../scoring.js';

export const SERIES = { f1: 'Formuła 1', lmu: 'Le Mans Ultimate', inne: 'Eventy' };

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

// Godzina zawsze w formacie 24-godzinnym. Natywne pola datetime-local / time pokazują AM/PM, gdy przeglądarka
// ma angielski język — strona nie może tego zmienić, dlatego godzinę wybiera się z list 00–23 i minut.
const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));

/** Godzina 'HH:MM' (24h). allowEmpty = można wyczyścić (np. pora dnia w grze). */
export function TimeInput({ value, onChange, disabled = false, allowEmpty = false }) {
  const [h = '', m = ''] = (value || '').slice(0, 5).split(':');
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => pad2(i * 5)), ...(m ? [m] : [])])].sort();
  return html`<span class="time-input">
    <select value=${h} disabled=${disabled} aria-label="Godzina" onChange=${(e) => onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')}>
      ${allowEmpty || !h ? html`<option value="">--</option>` : null}
      ${HOURS.map((x) => html`<option value=${x}>${x}</option>`)}
    </select><b>:</b><select value=${m} disabled=${disabled || !h} aria-label="Minuty" onChange=${(e) => onChange(`${h}:${e.target.value}`)}>
      ${!m ? html`<option value="">--</option>` : null}
      ${minutes.map((x) => html`<option value=${x}>${x}</option>`)}
    </select>
  </span>`;
}

/** Data i godzina (24h); value / onChange jak w polu datetime-local: 'YYYY-MM-DDTHH:MM' albo ''. */
export function DateTimeInput({ value, onChange, title }) {
  const [date = '', time = ''] = (value || '').split('T');
  const set = (d, t) => onChange(d ? `${d}T${t || '20:00'}` : '');
  return html`<span class="dt-input" title=${title}>
    <input type="date" value=${date} onChange=${(e) => set(e.target.value, time)} aria-label="Data" />
    <${TimeInput} value=${time} disabled=${!date} onChange=${(t) => set(date, t)} />
  </span>`;
}

/**
 * Czas trwania: godziny + minuty (moderator nie liczy sumy minut). value / onChange — minuty albo null (puste).
 * placeholder = domyślne minuty, gdy pole jest puste (np. 120 dla wyścigu); minuteStep = co ile minut lista.
 */
export function DurationInput({ value, onChange, placeholder = null, minuteStep = 5 }) {
  const empty = value == null || value === '';
  const base = empty ? placeholder : Number(value);
  const h = empty ? '' : Math.floor(base / 60);
  const m = base ? base % 60 : 0;
  const minutes = [...new Set([...Array.from({ length: 60 / minuteStep }, (_, i) => i * minuteStep), m])].sort((a, b) => a - b);
  const set = (hh, mm) => {
    const total = (Number(hh) || 0) * 60 + Number(mm);
    onChange(total > 0 ? total : null);
  };
  return html`<span class="duration-input">
    <input type="number" min="0" max="999" step="1" value=${h} placeholder=${placeholder ? String(Math.floor(placeholder / 60)) : '0'} aria-label="Godziny"
      onChange=${(e) => set(e.target.value, m)} /><span class="muted">h</span>
    <select value=${m} aria-label="Minuty" onChange=${(e) => set(h === '' ? Math.floor((placeholder || 0) / 60) : h, e.target.value)}>
      ${minutes.map((x) => html`<option value=${x}>${pad2(x)}</option>`)}
    </select><span class="muted">min</span>
  </span>`;
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
  post: ['Brak zdjęcia', 'Zdjęcie do ogłoszenia (opcjonalnie), najlepiej poziome'],
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

/** Wybór klasy samochodu; options = lista klas do wyboru (np. klasy sezonu, także własne klasy wydarzeń „Inne”). */
export function ClassSelect({ value, onChange, options }) {
  const list = options ? options.map(carClass).filter(Boolean) : LMU_CLASSES;
  return html`<select value=${value || ''} onChange=${(e) => onChange(e.target.value || null)} title="Klasa samochodu">
    <option value="">— klasa —</option>
    ${list.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
  </select>`;
}
