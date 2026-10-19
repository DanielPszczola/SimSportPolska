import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, Flag, attempt } from '../ui.js';
import { TracksAdmin } from './tracks.js';

// Dane wspólne dla wszystkich sezonów i serii.
const TABS = [
  ['tory', '🛣️ Tory'],
  ['kierowcy', '👤 Kierowcy'],
];

export function DatabaseAdmin({ tab }) {
  const current = TABS.some(([id]) => id === tab) ? tab : 'tory';
  return html`
    <div class="db-tabs">
      ${TABS.map(([id, label]) => html`<a href=${`#/admin/baza/${id}`} class=${`btn btn-sm ${current === id ? 'btn-accent' : ''}`}>${label}</a>`)}
    </div>
    ${current === 'tory' ? html`<${TracksAdmin} />` : null}
    ${current === 'kierowcy' ? html`<${DriversCard} />` : null}
  `;
}

function DriversCard() {
  const data = useAsync(() => db.list('drivers', { order: ['nick'] }), []);
  const [nd, setNd] = useState({ nick: '', country_code: 'PL', number: '' });
  const [q, setQ] = useState('');
  if (data.loading && !data.data) return html`<${Loader} />`;
  if (data.error) return html`<${ErrorBox} error=${data.error} />`;
  const drivers = data.data.filter((d) => d.nick.toLowerCase().includes(q.toLowerCase()));

  const add = async (e) => {
    e.preventDefault();
    const row = { nick: nd.nick.trim(), country_code: nd.country_code.trim().toUpperCase() || null, number: nd.number === '' ? null : Number(nd.number) };
    if (await attempt(() => db.insert('drivers', row), `Dodano kierowcę ${row.nick}`)) {
      setNd({ ...nd, nick: '', number: '' });
      data.reload();
    }
  };
  const patch = async (d, p) => (await attempt(() => db.update('drivers', d.id, p))) && data.reload();
  const remove = async (d) => {
    const res = await db.list('results', { eq: { driver_id: d.id } });
    if (res.length) return alert(`${d.nick} ma ${res.length} wynik(ów) w bazie — nie można go usunąć.`);
    if (!confirm(`Usunąć kierowcę ${d.nick}?`)) return;
    const ok = await attempt(async () => {
      await db.removeWhere('entries', { driver_id: d.id });
      await db.remove('drivers', d.id);
    }, 'Kierowca usunięty');
    if (ok) data.reload();
  };

  return html`<div class="card">
    <div class="card-head">
      <h2>Baza kierowców <span class="muted">(${data.data.length})</span></h2>
      <input class="search" placeholder="Szukaj…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>
    <p class="muted">Kierowcy są wspólni dla F1 i LMU oraz wszystkich sezonów — profil zbiera całą historię startów.
      Do składu sezonu dodajesz ich w kafelku <b>Start sezonu</b>.</p>
    <form class="inline-form" onSubmit=${add}>
      <input required placeholder="Nick (jak w grze)" value=${nd.nick} onInput=${(e) => setNd({ ...nd, nick: e.target.value })} />
      <input class="w-code" maxlength="2" placeholder="PL" title="Kod kraju (2 litery, ISO)" value=${nd.country_code} onInput=${(e) => setNd({ ...nd, country_code: e.target.value })} />
      <input class="w-num" type="number" min="0" max="999" placeholder="Nr" value=${nd.number} onInput=${(e) => setNd({ ...nd, number: e.target.value })} />
      <button class="btn btn-accent">+ Dodaj kierowcę</button>
    </form>
    <div class="table-wrap"><table class="table edit-table">
      <thead><tr><th>Nick</th><th class="c">Kraj</th><th class="c">Nr</th><th class="r"></th></tr></thead>
      <tbody>
        ${drivers.map((d) => html`<tr key=${d.id}>
          <td><input value=${d.nick} onChange=${(e) => patch(d, { nick: e.target.value.trim() })} /></td>
          <td class="c nowrap"><${Flag} code=${d.country_code} size=${18} /> <input class="w-code" maxlength="2" value=${d.country_code || ''} onChange=${(e) => patch(d, { country_code: e.target.value.trim().toUpperCase() || null })} /></td>
          <td class="c"><input class="w-num" type="number" value=${d.number ?? ''} onChange=${(e) => patch(d, { number: e.target.value === '' ? null : Number(e.target.value) })} /></td>
          <td class="r"><button class="btn btn-sm btn-danger" onClick=${() => remove(d)}>Usuń</button></td>
        </tr>`)}
      </tbody>
    </table></div>
  </div>`;
}
