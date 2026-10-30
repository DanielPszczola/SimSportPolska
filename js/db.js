// Warstwa danych. Jedno API dla dwóch backendów:
//  - Supabase (produkcja) — gdy w config.js ustawiono URL i klucz,
//  - localStorage (tryb demo) — gdy konfiguracja jest pusta.
//
// list(table, { eq: {col: val}, in: {col: [vals]}, order: ['col', asc?] })
// insert(table, row | rows) -> wstawione wiersze
// update(table, id, patch)  -> zaktualizowany wiersz
// remove(table, id), removeWhere(table, eq)
// uploadImage(blob, folder) -> publiczny URL obrazka
// seasonBundle(seasonId | null, series) -> wszystkie dane sezonu jednym zapytaniem (albo null, gdy niedostępne)
// rpc(name, args) -> wynik funkcji z bazy (np. discord_login)
//
// Po każdym zapisie wysyłane jest zdarzenie 'ssp-db-write' — czyści pamięć podręczną danych (ui.js).
import { SUPABASE_URL, SUPABASE_ANON_KEY, loginToEmail } from './config.js';

// biblioteka Supabase 2.116.0 jako jeden plik (vendor/supabase.js) — jedno żądanie zamiast łańcucha modułów z CDN
const SUPABASE_LIB = new URL('../vendor/supabase.js', import.meta.url).href;

function loadSupabaseLib() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SUPABASE_LIB;
    s.onload = () => resolve(window.supabase);
    s.onerror = () => reject(new Error('Nie udało się wczytać biblioteki Supabase (vendor/supabase.js)'));
    document.head.appendChild(s);
  });
}
const IMAGE_BUCKET = 'images'; // Supabase Storage, tworzony w supabase/schema.sql

// komunikaty logowania Supabase po polsku (z podpowiedzią, co zrobić)
const AUTH_ERRORS = {
  'Invalid login credentials': 'Nieprawidłowy login lub hasło',
  'Email not confirmed': 'Konto nie jest potwierdzone. W Supabase: SQL Editor → update auth.users set email_confirmed_at = now() where email = \'<login>@<domena>\'; (albo załóż konto z „Auto Confirm User”)',
  'Invalid API key': 'Nieprawidłowy klucz API w js/config.js — wklej klucz „Publishable” (sb_publishable_…) z Supabase → Project Settings → API Keys',
};

async function createSupabaseDb() {
  const { createClient } = await loadSupabaseLib();
  // PKCE: po logowaniu przez Discord wracamy z ?code=… w adresie (a nie w #), więc nie koliduje to z routerem strony
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce' } });
  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    await sb.auth.getSession(); // Supabase wymienia kod z Discorda na sesję
    if (params.get('error_description')) sessionStorage.setItem('ssp_auth_error', params.get('error_description'));
    history.replaceState(history.state, '', location.pathname + location.hash);
  }

  return {
    mode: 'supabase',
    async list(table, { eq = {}, in: inn = {}, order } = {}) {
      let q = sb.from(table).select('*');
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      for (const [k, arr] of Object.entries(inn)) {
        if (!arr.length) return [];
        q = q.in(k, arr);
      }
      if (order) q = q.order(order[0], { ascending: order[1] !== false });
      return check(await q);
    },
    async insert(table, rows) {
      const many = Array.isArray(rows);
      if (many && !rows.length) return [];
      const data = check(await sb.from(table).insert(rows).select());
      return many ? data : data[0];
    },
    async update(table, id, patch) {
      return check(await sb.from(table).update(patch).eq('id', id).select().single());
    },
    async remove(table, id) {
      check(await sb.from(table).delete().eq('id', id));
    },
    async removeWhere(table, eq) {
      let q = sb.from(table).delete();
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      check(await q);
    },
    // jedno zapytanie zamiast ~9 w trzech falach (funkcja season_bundle w supabase/schema.sql);
    // gdy funkcji jeszcze nie ma w bazie, zwraca null i strona pobiera dane po staremu
    async seasonBundle(seasonId, series) {
      if (bundleRpcMissing) return null;
      const { data, error } = await sb.rpc('season_bundle', { p_season: seasonId || null, p_series: series || null });
      if (error) {
        bundleRpcMissing = true;
        console.info('season_bundle niedostępne — uruchom ponownie supabase/schema.sql, aby przyspieszyć stronę.', error.message);
        return null;
      }
      return data;
    },
    async rpc(name, args = {}) {
      return check(await sb.rpc(name, args));
    },
    async uploadImage(blob, folder) {
      const ext = blob.type === 'image/png' ? 'png' : 'webp';
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await sb.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
      if (error) throw new Error(`Nie udało się wgrać pliku: ${error.message}`);
      return sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    },
    auth: {
      async user() {
        const { data } = await sb.auth.getSession();
        return data.session?.user ?? null;
      },
      async signIn(login, password) {
        const { error } = await sb.auth.signInWithPassword({ email: loginToEmail(login), password });
        if (error) throw new Error(AUTH_ERRORS[error.message] || error.message);
      },
      async signInWithDiscord() {
        try { sessionStorage.setItem('ssp_return_hash', location.hash || '#/konto'); } catch { /* tryb prywatny */ }
        const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin + location.pathname } });
        if (error) throw new Error(error.message);
      },
      /** Adres (#…), na który wracamy po zalogowaniu przez Discord — jednorazowo. */
      takeReturnHash() {
        try {
          const h = sessionStorage.getItem('ssp_return_hash');
          sessionStorage.removeItem('ssp_return_hash');
          return h;
        } catch { return null; }
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async isAdmin() {
        const { data, error } = await sb.rpc('is_admin');
        return !error && data === true;
      },
    },
  };
}

let bundleRpcMissing = false;

/** Po każdym udanym zapisie powiadamiamy stronę, żeby wyczyściła pamięć podręczną danych. */
function withWriteEvents(adapter) {
  for (const m of ['insert', 'update', 'remove', 'removeWhere', 'rpc']) {
    const fn = adapter[m].bind(adapter);
    adapter[m] = async (...args) => {
      const r = await fn(...args);
      window.dispatchEvent(new Event('ssp-db-write'));
      return r;
    };
  }
  return adapter;
}

// tryb demo (dane w przeglądarce + przykładowe dane ~200 KB) ładujemy tylko wtedy, gdy nie ma konfiguracji Supabase
export const db = withWriteEvents(SUPABASE_URL && SUPABASE_ANON_KEY
  ? await createSupabaseDb()
  : (await import('./db-local.js')).createLocalDb());
