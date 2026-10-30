import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, Flag, attempt } from '../ui.js';
import { TracksAdmin } from './tracks.js';

// Dane wspólne dla wszystkich sezonów i serii.
const TABS = [
  ['tory', '🛣️ Tory'],
  ['kierowcy', '👤 Kierowcy'],
  ['discord', '💬 Konta Discord'],
];

// konta Discord (tabela z supabase/migrations/2026-10-30_discord.sql); bez niej / w demo — pusta lista
const loadAccounts = () => (db.mode === 'demo' ? Promise.resolve({ rows: [], missing: true })
  : db.list('discord_accounts', { order: ['created_at'] }).then((rows) => ({ rows }), () => ({ rows: [], missing: true })));

/** Powiązanie konta Discord z kierowcą (funkcja discord_link w bazie; scala profil założony automatycznie). */
async function linkAccount(acc, driver, drivers) {
  const auto = acc.auto_driver && acc.driver_id && acc.driver_id !== driver.id ? drivers.find((d) => d.id === acc.driver_id) : null;
  const msg = [`Powiązać kierowcę ${driver.nick} z kontem Discord ${acc.display_name} (@${acc.username})?`,
    acc.display_name && acc.display_name !== driver.nick ? `Nick zmieni się na „${acc.display_name}” (nick zawsze jak na Discordzie).` : '',
    auto ? `Profil „${auto.nick}” założony automatycznie przy pierwszym logowaniu zostanie scalony z ${driver.nick} — jego wyniki przejdą na ten profil.` : '',
  ].filter(Boolean).join('\n\n');
  if (!confirm(msg)) return false;
  return attempt(() => db.rpc('discord_link', { p_user: acc.user_id, p_driver: driver.id }), `Powiązano ${driver.nick} z kontem Discord`);
}

function DiscordChip({ acc }) {
  return html`<span class="discord-chip" title=${`Discord: @${acc.username || ''}`}>
    ${acc.avatar_url ? html`<img src=${acc.avatar_url} alt="" />` : html`<span class="dot"></span>`}@${acc.username || acc.display_name}
  </span>`;
}

export function DatabaseAdmin({ tab }) {
  const current = TABS.some(([id]) => id === tab) ? tab : 'tory';
  return html`
    <div class="db-tabs">
      ${TABS.map(([id, label]) => html`<a href=${`#/admin/baza/${id}`} class=${`btn btn-sm ${current === id ? 'btn-accent' : ''}`}>${label}</a>`)}
    </div>
    ${current === 'tory' ? html`<${TracksAdmin} />` : null}
    ${current === 'kierowcy' ? html`<${DriversCard} />` : null}
    ${current === 'discord' ? html`<${DiscordCard} />` : null}
  `;
}

function DriversCard() {
  const data = useAsync(() => db.list('drivers', { order: ['nick'] }), []);
  const accounts = useAsync(loadAccounts, []);
  const [nd, setNd] = useState({ nick: '', country_code: 'PL', number: '' });
  const [q, setQ] = useState('');
  if ((data.loading && !data.data) || (accounts.loading && !accounts.data)) return html`<${Loader} />`;
  if (data.error) return html`<${ErrorBox} error=${data.error} />`;
  const drivers = data.data.filter((d) => d.nick.toLowerCase().includes(q.toLowerCase()));
  const accs = accounts.data.rows;
  const accOf = (d) => accs.find((a) => a.driver_id === d.id);
  // do powiązania: konta bez kierowcy albo z profilem założonym automatycznie
  const linkable = accs.filter((a) => !a.driver_id || a.auto_driver);
  const link = async (d, userId) => {
    const acc = accs.find((a) => a.user_id === userId);
    if (acc && await linkAccount(acc, d, data.data)) {
      data.reload();
      accounts.reload();
    }
  };

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
      <thead><tr><th>Nick</th><th class="c">Kraj</th><th class="c">Nr</th>${accounts.data.missing ? null : html`<th>Discord</th>`}<th class="r"></th></tr></thead>
      <tbody>
        ${drivers.map((d) => html`<tr key=${d.id}>
          <td><input value=${d.nick} onChange=${(e) => patch(d, { nick: e.target.value.trim() })} /></td>
          <td class="c nowrap"><${Flag} code=${d.country_code} size=${18} /> <input class="w-code" maxlength="2" value=${d.country_code || ''} onChange=${(e) => patch(d, { country_code: e.target.value.trim().toUpperCase() || null })} /></td>
          <td class="c"><input class="w-num" type="number" value=${d.number ?? ''} onChange=${(e) => patch(d, { number: e.target.value === '' ? null : Number(e.target.value) })} /></td>
          ${accounts.data.missing ? null : html`<td>${accOf(d)
            ? html`<${DiscordChip} acc=${accOf(d)} />`
            : html`<select value="" onChange=${(e) => e.target.value && link(d, e.target.value)} disabled=${!linkable.length} title=${linkable.length ? 'Powiąż z kontem Discord' : 'Brak kont Discord do powiązania (konto pojawia się po pierwszym zalogowaniu)'}>
                <option value="">${linkable.length ? '— powiąż z kontem —' : '— brak kont —'}</option>
                ${linkable.map((a) => html`<option value=${a.user_id}>${a.display_name} (@${a.username})${a.auto_driver ? ' · profil auto' : ''}</option>`)}
              </select>`}</td>`}
          <td class="r"><button class="btn btn-sm btn-danger" onClick=${() => remove(d)}>Usuń</button></td>
        </tr>`)}
      </tbody>
    </table></div>
  </div>`;
}

// ---------- konta Discord: prośby o powiązanie, konta bez profilu, powiązane ----------

function DiscordCard() {
  const data = useAsync(async () => {
    const [drivers, accounts] = await Promise.all([db.list('drivers', { order: ['nick'] }), loadAccounts()]);
    return { drivers, accounts: accounts.rows, missing: accounts.missing };
  }, []);
  if (data.loading && !data.data) return html`<${Loader} />`;
  if (data.error) return html`<${ErrorBox} error=${data.error} />`;
  const { drivers, accounts, missing } = data.data;
  if (db.mode === 'demo') return html`<div class="card"><h2>Konta Discord</h2><p class="muted">Logowanie przez Discord działa dopiero po podłączeniu Supabase.</p></div>`;
  if (missing) return html`<div class="card"><h2>Konta Discord</h2><div class="hint warn">Uruchom w Supabase → SQL Editor plik <b>supabase/migrations/2026-10-30_discord.sql</b> (nic nie kasuje).</div></div>`;

  const nick = (id) => drivers.find((d) => d.id === id)?.nick ?? '?';
  const taken = new Set(accounts.map((a) => a.driver_id).filter(Boolean));
  const free = drivers.filter((d) => !taken.has(d.id));
  const done = (ok) => ok && data.reload();
  const approve = async (a) => done(await linkAccount(a, drivers.find((d) => d.id === a.claim_driver_id), drivers));
  const reject = async (a) => confirm(`Odrzucić prośbę ${a.display_name} o powiązanie z ${nick(a.claim_driver_id)}?`)
    && done(await attempt(() => db.rpc('discord_reject_claim', { p_user: a.user_id }), 'Prośba odrzucona'));
  const linkTo = async (a, driverId) => driverId && done(await linkAccount(a, drivers.find((d) => d.id === driverId), drivers));
  const createFor = async (a) => {
    if (!confirm(`Utworzyć nowego kierowcę „${a.display_name}” i powiązać go z kontem @${a.username}?`)) return;
    done(await attempt(async () => {
      const d = await db.insert('drivers', { nick: a.display_name, avatar_url: a.avatar_url || null });
      await db.rpc('discord_link', { p_user: a.user_id, p_driver: d.id });
    }, `Utworzono kierowcę ${a.display_name}`));
  };
  const unlink = async (a) => confirm(`Odłączyć konto @${a.username} od kierowcy ${nick(a.driver_id)}? Kierowca i jego wyniki zostają w bazie.`)
    && done(await attempt(() => db.rpc('discord_link', { p_user: a.user_id, p_driver: null }), 'Konto odłączone'));

  const pending = accounts.filter((a) => a.claim_driver_id);
  const orphan = accounts.filter((a) => !a.driver_id && !a.claim_driver_id);
  const linked = accounts.filter((a) => a.driver_id && !a.claim_driver_id);
  const who = (a) => html`<div class="who">
    ${a.avatar_url ? html`<img src=${a.avatar_url} alt="" />` : html`<span class="dot"></span>`}
    <div><b>${a.display_name}</b><div class="muted small">@${a.username}${a.last_login_at ? ` · ostatnio ${new Date(a.last_login_at).toLocaleDateString('pl-PL')}` : ''}</div></div>
  </div>`;
  const pickDriver = (a, label) => html`<select value="" onChange=${(e) => linkTo(a, e.target.value)}>
    <option value="">${label}</option>
    ${free.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}
  </select>`;

  return html`<div class="card">
    <h2>Konta Discord <span class="muted">(${accounts.length})</span></h2>
    <p class="muted">Konto pojawia się tu po pierwszym zalogowaniu przez Discord. Nowy kierowca dostaje profil automatycznie (nick z Discorda);
      jeśli nick zgadza się z istniejącym kierowcą, czeka tu na zatwierdzenie. Po powiązaniu nick kierowcy jest zawsze taki jak na Discordzie,
      a profil założony automatycznie zostaje scalony z wybranym kierowcą — wyniki nie giną.</p>

    <h3>Do zatwierdzenia (${pending.length})</h3>
    <div class="discord-list">
      ${pending.map((a) => html`<div class="discord-row" key=${a.user_id}>
        ${who(a)}
        <div>chce połączyć z profilem <b>${nick(a.claim_driver_id)}</b>${a.driver_id ? html`<div class="muted small">obecny profil: ${nick(a.driver_id)}${a.auto_driver ? ' (auto — zostanie scalony)' : ''}</div>` : null}</div>
        <button class="btn btn-sm btn-accent" onClick=${() => approve(a)}>✓ Zatwierdź</button>
        <button class="btn btn-sm" onClick=${() => reject(a)}>Odrzuć</button>
      </div>`)}
      ${!pending.length ? html`<p class="muted small">Brak próśb.</p>` : null}
    </div>

    <h3>Bez profilu kierowcy (${orphan.length})</h3>
    <div class="discord-list">
      ${orphan.map((a) => html`<div class="discord-row" key=${a.user_id}>
        ${who(a)}
        <div class="inline-form">
          ${pickDriver(a, '— powiąż z kierowcą —')}
          <button class="btn btn-sm" onClick=${() => createFor(a)}>+ Nowy kierowca „${a.display_name}”</button>
        </div>
      </div>`)}
      ${!orphan.length ? html`<p class="muted small">Brak.</p>` : null}
    </div>

    <h3>Powiązane (${linked.length})</h3>
    <div class="discord-list">
      ${linked.map((a) => html`<div class="discord-row" key=${a.user_id}>
        ${who(a)}
        <div>→ <a href=${`#/kierowca/${a.driver_id}`}><b>${nick(a.driver_id)}</b></a>${a.auto_driver ? html` <span class="badge" title="Profil utworzony automatycznie przy pierwszym logowaniu">auto</span>` : null}</div>
        <div class="inline-form">
          ${pickDriver(a, '— zmień kierowcę —')}
          <button class="btn btn-sm btn-danger" onClick=${() => unlink(a)}>Odłącz</button>
        </div>
      </div>`)}
      ${!linked.length ? html`<p class="muted small">Brak.</p>` : null}
    </div>
  </div>`;
}
