// Sesja zalogowanego użytkownika: kto jest zalogowany, czy przez Discord, czy jest adminem.
// Odświeżana przy starcie strony i po każdym zalogowaniu / wylogowaniu (zdarzenie 'ssp-auth');
// komponenty dostają zmiany przez zdarzenie 'ssp-session' (hook useSession).
import { useState, useEffect } from '../vendor/preact-htm.js';
import { db } from './db.js';
import { emailToLogin } from './config.js';

const state = { ready: false, user: null, account: null, role: null, isOwner: false, isAdmin: false, isStaff: false };

/** Uprawnienia wynikające z rangi: konto główne > admin > moderator > użytkownik. */
export function rolePerms(role) {
  const isOwner = role === 'owner';
  const isAdmin = isOwner || role === 'admin';
  return { role, isOwner, isAdmin, isStaff: isAdmin || role === 'moderator' };
}

export const isDiscordUser = (u) => !!u && (u.app_metadata?.provider === 'discord' || (u.app_metadata?.providers || []).includes('discord'));

/** Nazwa do wyświetlenia: nick z Discorda albo login admina. */
export function userLabel(user, account) {
  if (!user) return '';
  if (isDiscordUser(user)) return account?.display_name || user.user_metadata?.custom_claims?.global_name || user.user_metadata?.full_name || 'Discord';
  return emailToLogin(user.email || '');
}

const emit = () => window.dispatchEvent(new Event('ssp-session'));

export async function refreshSession() {
  try {
    const user = await db.auth.user();
    let account = null;
    if (isDiscordUser(user)) {
      // utworzenie / odświeżenie konta i profilu kierowcy (funkcja discord_login w bazie)
      try { account = await db.rpc('discord_login'); } catch (e) { account = { status: 'error', error: e.message }; }
    }
    const role = user ? await db.auth.role() : null;
    Object.assign(state, { ready: true, user, account, ...rolePerms(role) });
  } catch {
    Object.assign(state, { ready: true, user: null, account: null, ...rolePerms(null) });
  }
  emit();
  // powrót z Discorda: wracamy na stronę, z której kliknięto „Zaloguj przez Discord”
  // (nieudane logowanie → strona „Moje konto” z komunikatem błędu)
  const back = db.auth.takeReturnHash?.();
  let failed = false;
  try { failed = !!sessionStorage.getItem('ssp_auth_error'); } catch { /* tryb prywatny */ }
  if (back && state.user) location.hash = back;
  else if (failed) location.hash = '#/konto';
}

export function setAccount(account) {
  state.account = account;
  emit();
}

export function useSession() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    window.addEventListener('ssp-session', fn);
    fn(); // sesja mogła się wczytać między pierwszym renderem a podpięciem nasłuchu
    return () => window.removeEventListener('ssp-session', fn);
  }, []);
  return state;
}

window.addEventListener('ssp-auth', refreshSession);
refreshSession();
