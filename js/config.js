// Konfiguracja połączenia z bazą Supabase.
// Dopóki oba pola są puste, strona działa w TRYBIE DEMO: dane trzymane są
// tylko w przeglądarce (localStorage), a do panelu admina logujesz się
// dowolnym loginem i hasłem "admin".
//
// Gdzie to znaleźć: Supabase → Project Settings
//   SUPABASE_URL      = Data API → "Project URL" (https://<id-projektu>.supabase.co)
//   SUPABASE_ANON_KEY = API Keys → "Publishable key" (sb_publishable_…) albo Legacy API keys → "anon" (eyJ…).
//                        Klucz jest publiczny i może być w repo — bezpieczeństwo zapewniają reguły RLS
//                        z pliku supabase/schema.sql. NIGDY nie wpisuj tu klucza "Secret" / "service_role".
//                        Uwaga: to nie jest identyfikator projektu (20 znaków z adresu).
const PROD_URL = 'https://sdlkqrwxbqhvnxoflpjh.supabase.co';
const PROD_KEY = 'sb_publishable_vP4XYKzoxGsTbifaHacRmQ_LdBdSkEn';

// Lokalny pre-prod (preprod.bat): na localhost plik js/config.local.js — jeśli istnieje — przełącza stronę
// na lokalną bazę w Dockerze. Plik jest generowany automatycznie i nie trafia do repozytorium ani na serwer.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? await import('./config.local.js').catch(() => null)
  : null;

export const SUPABASE_URL = LOCAL?.SUPABASE_URL ?? PROD_URL;
export const SUPABASE_ANON_KEY = LOCAL?.SUPABASE_ANON_KEY ?? PROD_KEY;

export const LEAGUE_NAME = 'Sim Sport Polska';

// Logowanie loginem zamiast e-maila. Supabase wymaga e-maila przy koncie, więc login jest zamieniany
// na techniczny adres <login>@LOGIN_DOMAIN. Konto admina zakładasz w Supabase z takim właśnie adresem,
// np. login "daniel" -> e-mail "daniel@ssp.example.com" (domena example.com nie przyjmuje poczty).
export const LOGIN_DOMAIN = 'ssp.example.com';

/** login -> e-mail konta (pełny adres e-mail jest przyjmowany bez zmian). */
export const loginToEmail = (login) => {
  const l = String(login || '').trim().toLowerCase();
  return l.includes('@') ? l : `${l}@${LOGIN_DOMAIN}`;
};

/** e-mail konta -> login do wyświetlenia. */
export const emailToLogin = (email) => {
  const e = String(email || '');
  return e.endsWith(`@${LOGIN_DOMAIN}`) ? e.slice(0, -(LOGIN_DOMAIN.length + 1)) : e;
};
