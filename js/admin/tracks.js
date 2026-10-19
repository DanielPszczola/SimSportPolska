import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, Flag, attempt, youtubeId, VideoEmbed } from '../ui.js';
import { TRACK_CATEGORIES } from '../tracks-seed.js';
import { ImageField } from './common.js';

// Baza torów: każdy tor należy do jednej kategorii samochodu (F1 / HY / LMP / GT3),
// więc np. Spa dla F1 i Spa dla GT3 to osobne wpisy z własną nitką toru i filmem.
export function TracksAdmin() {
  const data = useAsync(() => db.list('tracks', { order: ['name'] }), []);
  const [cat, setCat] = useState('F1');
  const [q, setQ] = useState('');
  const [nt, setNt] = useState({ name: '', country: '', country_code: '', length_km: '' });

  if (data.loading && !data.data) return html`<${Loader} />`;
  if (data.error) return html`<${ErrorBox} error=${data.error} />`;
  const all = data.data;
  const tracks = all.filter((t) => t.category === cat && `${t.name} ${t.country}`.toLowerCase().includes(q.toLowerCase()));
  const catLabel = (id) => TRACK_CATEGORIES.find((c) => c.id === id)?.label ?? id;

  const add = async (e) => {
    e.preventDefault();
    const row = {
      name: nt.name.trim(), country: nt.country.trim(), country_code: nt.country_code.trim().toUpperCase() || null,
      length_km: nt.length_km ? Number(String(nt.length_km).replace(',', '.')) : null, category: cat, layout_url: null, video_url: null,
    };
    if (await attempt(() => db.insert('tracks', row), `Dodano tor ${row.name} (${catLabel(cat)})`)) {
      setNt({ name: '', country: '', country_code: '', length_km: '' });
      data.reload();
    }
  };
  const patch = async (t, p) => (await attempt(() => db.update('tracks', t.id, p))) && data.reload();
  const setVideo = (t, value) => {
    const v = value.trim();
    if (!v) return patch(t, { video_url: null });
    const id = youtubeId(v);
    if (!id) return alert('To nie wygląda na link do YouTube. Wklej adres filmu, np. https://www.youtube.com/watch?v=…');
    return patch(t, { video_url: `https://www.youtube.com/watch?v=${id}` });
  };
  const copyTo = async (t, category) => {
    if (!category) return;
    if (all.some((x) => x.category === category && x.name === t.name)) return alert(`Tor ${t.name} istnieje już w kategorii ${catLabel(category)}.`);
    const { id, created_at, layout_url, video_url, ...rest } = t;
    if (await attempt(() => db.insert('tracks', { ...rest, category, layout_url: null, video_url: null }),
      `Skopiowano ${t.name} do kategorii ${catLabel(category)} — dodaj tam nitkę toru i film`)) data.reload();
  };
  const remove = async (t) => {
    const used = await db.list('races', { eq: { track_id: t.id } });
    if (used.length) return alert(`Tor ${t.name} (${catLabel(t.category)}) jest użyty w ${used.length} wyścigu(ach) — nie można go usunąć.`);
    if (!confirm(`Usunąć tor ${t.name} z kategorii ${catLabel(t.category)}?`)) return;
    if (await attempt(() => db.remove('tracks', t.id), 'Tor usunięty')) data.reload();
  };

  return html`<div class="card">
    <div class="card-head">
      <h2>Baza torów</h2>
      <input class="search" placeholder="Szukaj…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>
    <p class="muted">Każdy tor należy do jednej kategorii samochodu, więc ma własną nitkę toru i własny film z przejazdu.
      Sezon F1 widzi tylko tory F1, a sezon LMU tory klas Hypercar / LMP / GT3.</p>

    <div class="cat-tabs" role="tablist">
      ${TRACK_CATEGORIES.map((c) => html`<button role="tab" aria-selected=${cat === c.id} class=${`cat-tab ${cat === c.id ? 'active' : ''}`} onClick=${() => setCat(c.id)}>
        ${c.label} <span>${all.filter((t) => t.category === c.id).length}</span>
      </button>`)}
    </div>

    <form class="inline-form" onSubmit=${add}>
      <input required placeholder=${`Nowy tor — ${catLabel(cat)}`} value=${nt.name} onInput=${(e) => setNt({ ...nt, name: e.target.value })} />
      <input placeholder="Kraj" value=${nt.country} onInput=${(e) => setNt({ ...nt, country: e.target.value })} />
      <input class="w-code" maxlength="2" placeholder="Kod" title="Kod kraju ISO, 2 litery (flaga)" value=${nt.country_code} onInput=${(e) => setNt({ ...nt, country_code: e.target.value })} />
      <input class="w-num" placeholder="km" value=${nt.length_km} onInput=${(e) => setNt({ ...nt, length_km: e.target.value })} />
      <button class="btn btn-accent">+ Dodaj tor</button>
    </form>

    <div class="track-grid">
      ${tracks.map((t) => html`<div class="track-card" key=${t.id}>
        <${ImageField} kind="track" value=${t.layout_url} onChange=${(v) => patch(t, { layout_url: v })} />
        <div class="track-card-body">
          <label class="field"><span>Nazwa</span><input value=${t.name} onChange=${(e) => patch(t, { name: e.target.value.trim() })} /></label>
          <div class="track-card-row">
            <label class="field"><span>Kraj</span><input value=${t.country || ''} onChange=${(e) => patch(t, { country: e.target.value })} /></label>
            <label class="field"><span>Kod <${Flag} code=${t.country_code} size=${14} /></span><input class="w-code" maxlength="2" value=${t.country_code || ''} onChange=${(e) => patch(t, { country_code: e.target.value.toUpperCase() || null })} /></label>
            <label class="field"><span>km</span><input class="w-num" value=${t.length_km ?? ''} onChange=${(e) => patch(t, { length_km: e.target.value ? Number(e.target.value.replace(',', '.')) : null })} /></label>
          </div>
          <label class="field"><span>Film z przejazdu (YouTube)</span>
            <input value=${t.video_url || ''} placeholder="https://www.youtube.com/watch?v=…" onChange=${(e) => setVideo(t, e.target.value)} />
          </label>
          ${youtubeId(t.video_url) ? html`<${VideoEmbed} url=${t.video_url} title=${t.name} />` : null}
          <div class="track-card-actions">
            <select value="" onChange=${(e) => copyTo(t, e.target.value)} title="Utwórz ten sam tor w innej kategorii">
              <option value="">Kopiuj do kategorii…</option>
              ${TRACK_CATEGORIES.filter((c) => c.id !== t.category).map((c) => html`<option value=${c.id}>${c.label}</option>`)}
            </select>
            <button class="btn btn-sm btn-danger" onClick=${() => remove(t)}>Usuń</button>
          </div>
        </div>
      </div>`)}
      ${!tracks.length ? html`<p class="muted">Brak torów w tej kategorii.</p>` : null}
    </div>
  </div>`;
}
