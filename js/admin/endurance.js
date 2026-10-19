import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, Flag, attempt, formatDate } from '../ui.js';
import { LMU_CLASSES, carClass } from '../scoring.js';
import { categoriesForSeries } from '../tracks-seed.js';
import { ImageField, ClassSelect, toLocalInput, fromLocalInput } from './common.js';

// LMU Endurance: wyścigi długodystansowe. Event = nazwa, tor, start, długość, transmisja;
// w evencie dowolna liczba zespołów Sim Sport Polska (klasa, auto, zdjęcie, kierowcy, wynik).

const TEAM_NAME = 'Sim Sport Polska';

export function EnduranceAdmin() {
  const data = useAsync(async () => {
    const [events, crews, tracks, drivers] = await Promise.all([
      db.list('endurance_events', { order: ['start_at'] }),
      db.list('endurance_crews', { order: ['created_at'] }),
      db.list('tracks', { order: ['name'] }),
      db.list('drivers', { order: ['nick'] }),
    ]);
    return { events, crews, tracks, drivers };
  }, []);
  const [open, setOpen] = useState(null);

  if (data.loading && !data.data) return html`<${Loader} />`;
  if (data.error) return html`<${ErrorBox} error=${data.error} />`;
  const { events, crews } = data.data;
  const upcoming = events.filter((e) => e.status !== 'finished');
  const finished = events.filter((e) => e.status === 'finished').reverse();

  const addEvent = async () => {
    const ev = await attempt(() => db.insert('endurance_events', {
      name: 'Nowy wyścig długodystansowy', track_id: null, start_at: null, duration_hours: 6, stream_url: null, status: 'scheduled', notes: '',
    }), 'Utworzono event — uzupełnij szczegóły i dodaj zespoły');
    if (ev) {
      setOpen(ev.id);
      data.reload();
    }
  };

  const row = (ev) => {
    const t = data.data.tracks.find((x) => x.id === ev.track_id);
    const n = crews.filter((c) => c.event_id === ev.id).length;
    const isOpen = open === ev.id;
    return html`<div class=${`end-admin ${isOpen ? 'open' : ''}`} key=${ev.id}>
      <button class="end-admin-head" onClick=${() => setOpen(isOpen ? null : ev.id)} aria-expanded=${isOpen}>
        <span class="end-admin-title"><b>${ev.name}</b>
          <span class="muted">${t ? html`<${Flag} code=${t.country_code} size=${16} /> ${t.name} · ` : ''}${ev.start_at ? formatDate(ev.start_at) : 'termin do ustalenia'}${ev.duration_hours ? ` · ${Number(ev.duration_hours)} h` : ''}</span>
        </span>
        <span class="end-admin-side">
          <span class="badge">${n} ${n === 1 ? 'zespół' : 'zesp.'}</span>
          <span class=${`tile-state ${ev.status === 'finished' ? 'st-done' : 'st-next'}`}>${ev.status === 'finished' ? '✓ Zakończony' : 'Zaplanowany'}</span>
          <span class="chev">${isOpen ? '▲' : '▼'}</span>
        </span>
      </button>
      ${isOpen ? html`<${EventEditor} ev=${ev} data=${data.data} reload=${data.reload} onDeleted=${() => setOpen(null)} />` : null}
    </div>`;
  };

  return html`
    <div class="season-bar">
      <div class="season-bar-title"><span class="eyebrow">Le Mans Ultimate</span><b class="season-switch-static">Endurance — wyścigi długodystansowe</b></div>
      <button class="btn btn-accent btn-sm" onClick=${addEvent}>+ Nowy event</button>
    </div>
    <p class="muted">Dodaj event (tor, start, długość, transmisja) i zespoły Sim Sport Polska, które w nim jadą — każdy z własną klasą,
      autem i składem. Po wyścigu wpisz wyniki i oznacz event jako zakończony: pojawi się w zakładce <a href="#/lmu/endurance/wyniki">Le Mans Ultimate → Endurance → Wyniki</a>.</p>
    <h3>Nadchodzące (${upcoming.length})</h3>
    <div class="end-admin-list">${upcoming.map(row)}${!upcoming.length ? html`<p class="muted">Brak zaplanowanych eventów.</p>` : null}</div>
    <h3>Zakończone (${finished.length})</h3>
    <div class="end-admin-list">${finished.map(row)}${!finished.length ? html`<p class="muted">Brak zakończonych eventów.</p>` : null}</div>
  `;
}

function EventEditor({ ev, data, reload, onDeleted }) {
  const crews = data.crews.filter((c) => c.event_id === ev.id);
  const lmuCats = categoriesForSeries('lmu');
  const patch = async (p) => (await attempt(() => db.update('endurance_events', ev.id, p))) && reload();
  const setStream = (v) => {
    const url = v.trim();
    if (url && !/^https?:\/\//i.test(url)) return alert('Podaj pełny adres, np. https://www.youtube.com/live/…');
    return patch({ stream_url: url || null });
  };
  const addCrew = async () => {
    const used = crews.map((c) => c.name);
    let n = crews.length + 1;
    while (used.includes(`${TEAM_NAME} #${n}`)) n++;
    if (await attempt(() => db.insert('endurance_crews', {
      event_id: ev.id, name: `${TEAM_NAME} #${n}`, car_class: 'GT3', car_number: String(n), car_model: '', car_image_url: null,
      driver_ids: [], result_status: null, position_class: null, position_overall: null, laps: null, result_note: '', hall_of_fame: false,
    }), 'Dodano zespół')) reload();
  };
  const remove = async () => {
    if (!confirm(`Usunąć event „${ev.name}” razem z ${crews.length} zespołami?`)) return;
    if (await attempt(() => db.remove('endurance_events', ev.id), 'Event usunięty')) {
      onDeleted();
      reload();
    }
  };

  const finished = ev.status === 'finished';
  const withResults = crews.filter((c) => c.result_status || c.position_class).length;
  const finish = async () => {
    if (withResults < crews.length && !confirm(`Wyniki wpisano dla ${withResults} z ${crews.length} zespołów. Zakończyć event mimo to?`)) return;
    if (await attempt(() => db.update('endurance_events', ev.id, { status: 'finished' }), 'Event zakończony — wyniki są widoczne w zakładce Endurance → Wyniki')) reload();
  };
  const reopen = async () => {
    if (await attempt(() => db.update('endurance_events', ev.id, { status: 'scheduled' }), 'Event wrócił do kalendarza')) reload();
  };

  return html`<div class="end-admin-body">
    <div class=${`end-status ${finished ? 'is-finished' : ''}`}>
      <div>
        <span class="field-label">Status eventu</span>
        <div class="end-status-value">${finished ? '✓ Zakończony — wyniki są opublikowane' : 'Zaplanowany — widoczny w kalendarzu Endurance'}</div>
        ${!finished && withResults ? html`<div class="hint warn">Wpisano wyniki ${withResults} z ${crews.length} zespołów, ale event jest nadal zaplanowany — wyniki nie są jeszcze widoczne na stronie.</div>` : null}
      </div>
      ${finished
        ? html`<button class="btn" onClick=${reopen}>↺ Przywróć do kalendarza</button>`
        : html`<button class="btn btn-accent btn-big" onClick=${finish}>✓ Zakończ event i opublikuj wyniki</button>`}
    </div>
    <div class="form-grid">
      <label class="field span2"><span>Nazwa eventu</span><input value=${ev.name} onChange=${(e) => patch({ name: e.target.value.trim() || ev.name })} placeholder="np. 24h Le Mans" /></label>
      <label class="field span2"><span>Tor</span>
        <select value=${ev.track_id || ''} onChange=${(e) => patch({ track_id: e.target.value || null })}>
          <option value="">— wybierz tor —</option>
          ${lmuCats.map((c) => html`<optgroup label=${`Tory ${c.label}`}>
            ${data.tracks.filter((t) => t.category === c.id).map((t) => html`<option value=${t.id}>${t.name} · ${c.label}</option>`)}
          </optgroup>`)}
        </select>
      </label>
      <label class="field"><span>Start</span><input type="datetime-local" value=${toLocalInput(ev.start_at)} onChange=${(e) => patch({ start_at: fromLocalInput(e.target.value) })} /></label>
      <label class="field"><span>Długość (godziny)</span><input type="number" min="0.5" step="0.5" value=${ev.duration_hours ?? ''} onChange=${(e) => patch({ duration_hours: e.target.value ? Number(e.target.value) : null })} /></label>
      <label class="field span2"><span>Transmisja / powtórka (link, np. YouTube live)</span><input value=${ev.stream_url || ''} placeholder="https://www.youtube.com/live/…" onChange=${(e) => setStream(e.target.value)} /></label>
      <label class="field span2"><span>Opis (opcjonalnie)</span><input value=${ev.notes || ''} onChange=${(e) => patch({ notes: e.target.value })} placeholder="np. wyścig specjalny, start z pit lane" /></label>
    </div>

    <h3>Zespoły Sim Sport Polska w tym evencie (${crews.length})</h3>
    <div class="crew-edit-list">
      ${crews.map((c) => html`<${CrewEditor} key=${c.id} crew=${c} drivers=${data.drivers} finished=${ev.status === 'finished'} reload=${reload} />`)}
    </div>
    <div class="form-actions">
      <button class="btn btn-accent" onClick=${addCrew}>+ Dodaj zespół</button>
      <span class="spacer"></span>
      <button class="btn btn-danger btn-sm" onClick=${remove}>Usuń event</button>
    </div>
  </div>`;
}

function CrewEditor({ crew, drivers, finished, reload }) {
  const [pick, setPick] = useState('');
  const patch = async (p) => (await attempt(() => db.update('endurance_crews', crew.id, p))) && reload();
  const num = (v) => (v === '' ? null : Number(v));
  const ids = crew.driver_ids || [];
  const nick = (id) => drivers.find((d) => d.id === id)?.nick ?? '?';
  const addDriver = () => {
    if (!pick || ids.includes(pick)) return;
    patch({ driver_ids: [...ids, pick] });
    setPick('');
  };
  const remove = async () => {
    if (!confirm(`Usunąć zespół ${crew.name} z eventu?`)) return;
    if (await attempt(() => db.remove('endurance_crews', crew.id), 'Zespół usunięty')) reload();
  };

  return html`<div class="crew-edit" style=${{ '--cls': carClass(crew.car_class)?.color || 'var(--accent)' }}>
    <div class="crew-edit-car">
      <span class="field-label">Zdjęcie auta (malowanie ligowe)</span>
      <${ImageField} kind="car" value=${crew.car_image_url} onChange=${(v) => patch({ car_image_url: v })} />
    </div>
    <div class="crew-edit-main">
      <div class="form-grid">
        <label class="field span2"><span>Nazwa zespołu</span><input value=${crew.name} onChange=${(e) => patch({ name: e.target.value.trim() || crew.name })} /></label>
        <label class="field"><span>Klasa</span><${ClassSelect} value=${crew.car_class} options=${LMU_CLASSES.map((c) => c.id)} onChange=${(v) => patch({ car_class: v })} /></label>
        <label class="field"><span>Numer auta</span><input value=${crew.car_number || ''} onChange=${(e) => patch({ car_number: e.target.value.trim() || null })} placeholder="np. 77" /></label>
        <label class="field span2"><span>Model auta</span><input value=${crew.car_model || ''} onChange=${(e) => patch({ car_model: e.target.value.trim() })} placeholder="np. Porsche 963 / BMW M4 GT3" /></label>
      </div>
      <div class="field">
        <span>Kierowcy</span>
        <div class="crew-chips">
          ${ids.map((id) => html`<span class="chip chip-static">${nick(id)} <button class="chip-x" onClick=${() => patch({ driver_ids: ids.filter((x) => x !== id) })} aria-label=${`Usuń ${nick(id)}`}>×</button></span>`)}
          ${!ids.length ? html`<span class="muted small">Brak kierowców</span>` : null}
        </div>
        <div class="inline-form">
          <select value=${pick} onChange=${(e) => setPick(e.target.value)}>
            <option value="">— dodaj kierowcę z bazy —</option>
            ${drivers.filter((d) => !ids.includes(d.id)).map((d) => html`<option value=${d.id}>${d.nick}</option>`)}
          </select>
          <button class="btn btn-sm" onClick=${addDriver} disabled=${!pick}>+ Dodaj</button>
          <a class="muted small" href="#/admin/baza/kierowcy">Nowy kierowca? Baza danych →</a>
        </div>
      </div>
      <div class=${`crew-result-edit ${finished ? '' : 'dim'}`}>
        <span class="field-label">Wynik tego zespołu ${finished ? '' : '(po wyścigu wpisz wyniki, a potem kliknij „Zakończ event” u góry)'}</span>
        <div class="form-grid">
          <label class="field"><span>Wynik zespołu</span>
            <select value=${crew.result_status || ''} onChange=${(e) => patch({ result_status: e.target.value || null })}>
              <option value="">— nie wpisano —</option>
              <option value="FIN">FIN — ukończył wyścig</option>
              <option value="DNF">DNF — nie ukończył</option>
              <option value="DSQ">DSQ — dyskwalifikacja</option>
              <option value="DNS">DNS — nie wystartował</option>
            </select>
          </label>
          <label class="field"><span>Miejsce w klasie</span><input type="number" min="1" value=${crew.position_class ?? ''} onChange=${(e) => patch({ position_class: num(e.target.value) })} /></label>
          <label class="field"><span>Miejsce ogólnie</span><input type="number" min="1" value=${crew.position_overall ?? ''} onChange=${(e) => patch({ position_overall: num(e.target.value) })} /></label>
          <label class="field"><span>Okrążenia</span><input type="number" min="0" value=${crew.laps ?? ''} onChange=${(e) => patch({ laps: num(e.target.value) })} /></label>
          <label class="field hof-check" title="Wynik pojawi się w zakładce Galeria sław (po zakończeniu eventu)">
            <span>Galeria sław</span>
            <span class="check-inline"><input type="checkbox" checked=${!!crew.hall_of_fame} onChange=${(e) => patch({ hall_of_fame: e.target.checked })} /> 🏆 Pokaż w Galerii sław</span>
          </label>
          <label class="field span2"><span>Komentarz do wyniku</span><input value=${crew.result_note || ''} onChange=${(e) => patch({ result_note: e.target.value })} placeholder="np. awaria skrzyni w 18. godzinie" /></label>
        </div>
      </div>
      <div class="form-actions"><span class="spacer"></span><button class="btn btn-sm btn-danger" onClick=${remove}>Usuń zespół</button></div>
    </div>
  </div>`;
}
