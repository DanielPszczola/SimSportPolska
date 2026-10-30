import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, Loader, attempt } from '../ui.js';
import { useSession, setAccount, isDiscordUser, userLabel } from '../session.js';

// Moje konto: logowanie przez Discord i powiązanie konta z profilem kierowcy.

export function DiscordButton({ label = 'Zaloguj przez Discord' }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const ok = await attempt(() => db.auth.signInWithDiscord());
    if (!ok) setBusy(false); // przy powodzeniu przeglądarka przechodzi na Discorda
  };
  return html`<button type="button" class="btn btn-discord" onClick=${go} disabled=${busy}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 -.3 13.5.1 18a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.6ZM8.5 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
    ${busy ? 'Przekierowanie…' : label}
  </button>`;
}

export function AccountPage() {
  const s = useSession();
  let body;
  if (!s.ready) body = html`<${Loader} />`;
  else if (!s.user) body = html`<${Guest} />`;
  else if (!isDiscordUser(s.user)) body = html`<${PasswordUser} s=${s} />`;
  else body = html`<${DiscordAccount} s=${s} />`;
  return html`<div class="wrap page narrow">${body}</div>`;
}

const logout = async () => {
  await db.auth.signOut();
  window.dispatchEvent(new Event('ssp-auth'));
  location.hash = '#/';
};

function Guest() {
  // błąd zwrócony przez Discord / Supabase po nieudanym logowaniu (zapisany w db.js)
  const [error] = useState(() => {
    try {
      const e = sessionStorage.getItem('ssp_auth_error');
      sessionStorage.removeItem('ssp_auth_error');
      return e;
    } catch { return null; }
  });
  return html`<div class="card account-card">
    <h2>Zaloguj się</h2>
    ${error ? html`<div class="hint warn">Logowanie przez Discord nie powiodło się: ${error}</div>` : null}
    <p>Zaloguj się kontem Discord. Twoje konto zostanie powiązane z profilem kierowcy, a nick na stronie będzie zawsze taki jak na Discordzie.</p>
    ${db.mode === 'demo' ? html`<p class="hint warn">W trybie demo logowanie przez Discord nie działa — wymaga podłączenia Supabase.</p>` : null}
    <${DiscordButton} />
    <a class="muted small account-admin-link" href="#/admin">Logowanie administratora (login i hasło) →</a>
  </div>`;
}

function PasswordUser({ s }) {
  return html`<div class="card account-card">
    <h2>Konto administratora</h2>
    <p>Jesteś zalogowany jako <b>${userLabel(s.user)}</b>.</p>
    <div class="form-actions">
      ${s.isAdmin ? html`<a class="btn btn-accent" href="#/admin">Panel administratora →</a>` : null}
      <button class="btn" onClick=${logout}>Wyloguj</button>
    </div>
  </div>`;
}

function DiscordAccount({ s }) {
  const a = s.account || {};
  const name = userLabel(s.user, a);
  const avatar = a.avatar_url || s.user.user_metadata?.avatar_url;
  return html`<div class="card account-card">
    <div class="account-head">
      ${avatar ? html`<img class="account-avatar" src=${avatar} alt="" />` : html`<span class="account-avatar empty">${name.slice(0, 1)}</span>`}
      <div>
        <h2>${name}</h2>
        ${a.username ? html`<div class="muted small">Discord: @${a.username}</div>` : null}
      </div>
    </div>

    ${a.status === 'error' ? html`<div class="hint warn">Nie udało się połączyć konta z bazą ligi: ${a.error}.
      ${/discord_login|schema cache|function/i.test(a.error || '') ? html` Admin musi uruchomić w Supabase plik <b>supabase/migrations/2026-10-30_discord.sql</b>.` : null}</div>` : null}

    ${a.driver_id ? html`<div class="account-status ok">
      <span class="field-label">Twój profil kierowcy</span>
      <a class="account-driver" href=${`#/kierowca/${a.driver_id}`}>${a.driver_nick} →</a>
      <div class="muted small">Nick i awatar są pobierane z Discorda przy każdym logowaniu.</div>
    </div>` : null}

    ${a.claim_driver_id ? html`<div class="account-status pending">
      <span class="field-label">Czeka na potwierdzenie admina</span>
      <div>Prośba o powiązanie z profilem <b>${a.claim_nick}</b>.${a.driver_id ? ' Po zatwierdzeniu Twój obecny profil zostanie z nim połączony — wyniki z obu profili zostaną zachowane.' : ''}</div>
      <button class="btn btn-sm" onClick=${() => request(null)}>Anuluj prośbę</button>
    </div>` : null}

    ${a.status === 'unlinked' ? html`<div class="account-status">
      <span class="field-label">Brak profilu kierowcy</span>
      <div>Twoje konto nie jest jeszcze powiązane z profilem kierowcy. Jeśli startowałeś w lidze, wskaż swój profil poniżej — albo poczekaj, aż admin go powiąże.</div>
    </div>` : null}

    ${a.status && a.status !== 'error' && !a.claim_driver_id && (a.status === 'unlinked' || a.auto_driver) ? html`<${ClaimForm} own=${a.driver_id} first=${a.status === 'unlinked'} />` : null}

    <div class="form-actions">
      ${s.isAdmin ? html`<a class="btn btn-accent" href="#/admin">Panel administratora →</a>` : null}
      <span class="spacer"></span>
      <button class="btn" onClick=${logout}>Wyloguj</button>
    </div>
  </div>`;
}

async function request(driverId) {
  const acc = await attempt(() => db.rpc('discord_request_link', { p_driver: driverId }), driverId ? 'Prośba wysłana — admin musi ją zatwierdzić' : 'Prośba anulowana');
  if (acc && acc !== true) setAccount(acc);
}

/** „Startowałem już pod innym nickiem” — prośba do admina o powiązanie z istniejącym profilem. */
function ClaimForm({ own, first }) {
  const drivers = useAsync(() => db.list('drivers', { order: ['nick'] }), []);
  const [pick, setPick] = useState('');
  const [open, setOpen] = useState(first);
  if (!open) return html`<button class="link small account-claim-toggle" onClick=${() => setOpen(true)}>Startowałeś już w lidze pod innym nickiem? Połącz profile →</button>`;
  return html`<div class="account-claim">
    <span class="field-label">Mój dotychczasowy profil w lidze</span>
    ${drivers.loading ? html`<${Loader} />` : html`<div class="inline-form">
      <select value=${pick} onChange=${(e) => setPick(e.target.value)}>
        <option value="">— wybierz swój nick —</option>
        ${(drivers.data || []).filter((d) => d.id !== own).map((d) => html`<option value=${d.id}>${d.nick}</option>`)}
      </select>
      <button class="btn btn-sm btn-accent" disabled=${!pick} onClick=${() => request(pick)}>Wyślij prośbę do admina</button>
    </div>`}
    <div class="muted small">Admin sprawdzi prośbę i połączy profile — Twoje dotychczasowe wyniki zostaną przypisane do konta Discord.</div>
  </div>`;
}
