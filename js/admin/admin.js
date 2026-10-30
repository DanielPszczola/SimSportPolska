import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, attempt } from '../ui.js';
import { userLabel } from '../session.js';
import { DiscordButton } from '../pages/account.js';
import { SeriesAdmin } from './series.js';
import { DatabaseAdmin } from './database.js';
import { EnduranceAdmin } from './endurance.js';

const SECTIONS = [
  ['f1', 'Formuła 1', 'F1'],
  ['lmu', 'LMU Liga', 'LMU'],
  ['endurance', 'LMU Endurance', 'END'],
  ['baza', 'Baza danych', '🗂'],
];

export function AdminPage({ parts }) {
  const auth = useAsync(async () => {
    const user = await db.auth.user();
    return { user, isAdmin: user ? await db.auth.isAdmin() : false };
  }, []);

  if (auth.loading) return html`<div class="wrap page"><${Loader} /></div>`;
  if (auth.error) return html`<div class="wrap page"><${ErrorBox} error=${auth.error} /></div>`;
  const { user, isAdmin } = auth.data;
  if (!user) return html`<${Login} onDone=${auth.reload} />`;

  const logout = async () => {
    await db.auth.signOut();
    window.dispatchEvent(new Event('ssp-auth'));
    auth.reload();
  };

  if (!isAdmin) {
    return html`<div class="wrap page narrow">
      <div class="card">
        <h2>Brak uprawnień</h2>
        <p>Jesteś zalogowany jako <b>${userLabel(user)}</b>, ale to konto nie jest administratorem.</p>
        <p class="muted">Aby nadać uprawnienia, w Supabase → SQL Editor wykonaj:</p>
        <pre class="code">insert into admins (user_id) values ('${user.id}');</pre>
        <button class="btn" onClick=${logout}>Wyloguj</button>
      </div>
    </div>`;
  }

  const section = SECTIONS.some(([id]) => id === parts[0]) ? parts[0] : 'f1';
  return html`<div class="admin">
    <div class="section-head">
      <div class="wrap section-head-inner">
        <div class="section-title"><span class="series-chip admin">ADMIN</span><h1>Panel administratora</h1></div>
        <div class="admin-user"><span class="muted">${userLabel(user)}</span><button class="btn btn-sm" onClick=${logout}>Wyloguj</button></div>
      </div>
      <nav class="wrap subnav admin-sections">
        ${SECTIONS.map(([id, label, chip]) => html`<a href=${`#/admin/${id}`} class=${section === id ? 'active' : ''}>
          <span class=${`mini-chip mini-${id}`}>${chip}</span>${label}
        </a>`)}
      </nav>
    </div>
    <div class="wrap page">
      ${section === 'baza' ? html`<${DatabaseAdmin} tab=${parts[1]} />`
        : section === 'endurance' ? html`<${EnduranceAdmin} tab=${parts[1]} />`
        : html`<${SeriesAdmin} key=${section} series=${section} parts=${parts} />`}
    </div>
  </div>`;
}

function Login({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(() => db.auth.signIn(email, password), 'Zalogowano');
    setBusy(false);
    if (ok) {
      window.dispatchEvent(new Event('ssp-auth'));
      onDone();
    }
  };
  return html`<div class="wrap page narrow">
    <form class="card login" onSubmit=${submit}>
      <h2>🔒 Autoryzacja</h2>
      <p class="muted">Panel dostępny tylko dla administratorów ligi.</p>
      <label class="field"><span>Login</span><input type="text" required value=${email} onInput=${(e) => setEmail(e.target.value)} autocomplete="username" autocapitalize="none" spellcheck="false" /></label>
      <label class="field"><span>Hasło</span><input type="password" required value=${password} onInput=${(e) => setPassword(e.target.value)} autocomplete="current-password" /></label>
      <button class="btn btn-accent" disabled=${busy}>${busy ? 'Logowanie…' : 'Zaloguj się'}</button>
      ${db.mode !== 'demo' ? html`<div class="login-or"><span>albo</span></div><${DiscordButton} label="Zaloguj przez Discord (admin z kontem Discord)" />` : null}
    </form>
  </div>`;
}
