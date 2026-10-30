import { db } from '../db.js';
import { html, useAsync, Loader, ErrorBox, attempt } from '../ui.js';

// Administrator: lista użytkowników i nadawanie rang (funkcje list_users / set_user_role w bazie).
// Konta głównego („admin”) i własnej rangi nie da się zmienić — nikt nie odetnie wszystkich od panelu.

export const ROLES = [
  { id: 'admin', label: 'Admin', desc: 'pełny dostęp: zarządzanie ligą, rangi użytkowników, konta Discord' },
  { id: 'moderator', label: 'Moderator', desc: 'zarządzanie ligą: sezony, wyniki i czasy, kary, składy, kierowcy, tory, Endurance' },
  { id: 'user', label: 'Użytkownik', desc: 'bez dostępu do panelu' },
];

export const roleLabel = (role) => (role === 'owner' ? 'Konto główne' : ROLES.find((r) => r.id === role)?.label || 'Użytkownik');

export function UsersAdmin({ me }) {
  const data = useAsync(() => db.rpc('list_users'), []);
  if (data.loading && !data.data) return html`<${Loader} />`;
  if (data.error) {
    const missing = /list_users|schema cache|function/i.test(data.error.message || '');
    return missing
      ? html`<div class="card"><h2>Użytkownicy</h2><div class="hint warn">Uruchom w Supabase → SQL Editor plik <b>supabase/migrations/2026-10-30_rangi.sql</b> (nic nie kasuje).</div></div>`
      : html`<${ErrorBox} error=${data.error} />`;
  }
  const users = data.data || [];
  const setRole = async (u, role) => {
    if (role === u.role) return;
    const name = u.display_name || u.login;
    if (!confirm(`Zmienić rangę ${name} na „${roleLabel(role)}”?`)) return data.reload();
    if (await attempt(() => db.rpc('set_user_role', { p_user: u.user_id, p_role: role }), `${name}: ${roleLabel(role)}`)) data.reload();
  };
  const date = (d) => (d ? new Date(d).toLocaleDateString('pl-PL') : '—');

  return html`<div class="card">
    <h2>Użytkownicy i rangi <span class="muted">(${users.length})</span></h2>
    <ul class="roles-legend">
      ${ROLES.map((r) => html`<li><span class=${`role-badge role-${r.id}`}>${r.label}</span> ${r.desc}</li>`)}
    </ul>
    <p class="muted small">Każde nowe konto (np. zalogowane przez Discord) ma rangę Użytkownik. Rangi zmienia administrator;
      konto główne „admin” jest zawsze administratorem, a własnej rangi nie można zmienić.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Użytkownik</th><th>Logowanie</th><th class="hide-sm">Utworzone</th><th class="hide-sm">Ostatnio</th><th>Ranga</th></tr></thead>
      <tbody>
        ${users.map((u) => html`<tr key=${u.user_id}>
          <td><div class="user-cell">
            ${u.avatar_url ? html`<img src=${u.avatar_url} alt="" />` : html`<span class="dot">${(u.display_name || u.login || '?').slice(0, 1)}</span>`}
            <div><b>${u.display_name || u.login}</b>${u.driver_id ? html` <a class="muted small" href=${`#/kierowca/${u.driver_id}`}>profil →</a>` : null}
              ${u.display_name && u.provider !== 'discord' ? html`<div class="muted small">${u.login}</div>` : null}</div>
          </div></td>
          <td>${u.provider === 'discord' ? html`<span class="discord-chip"><span class="dot"></span>Discord</span>` : html`<span class="muted">login i hasło</span>`}</td>
          <td class="hide-sm muted">${date(u.created_at)}</td>
          <td class="hide-sm muted">${date(u.last_sign_in_at)}</td>
          <td>${u.role === 'owner' || u.user_id === me
            ? html`<span class=${`role-badge role-${u.role}`}>${roleLabel(u.role)}</span>${u.user_id === me ? html` <span class="muted small">(Ty)</span>` : null}`
            : html`<select class=${`role-select role-${u.role}`} value=${u.role} onChange=${(e) => setRole(u, e.target.value)}>
                ${ROLES.map((r) => html`<option value=${r.id}>${r.label}</option>`)}
              </select>`}</td>
        </tr>`)}
      </tbody>
    </table></div>
  </div>`;
}
