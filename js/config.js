// Konfiguracja połączenia z bazą Supabase.
// Dopóki oba pola są puste, strona działa w TRYBIE DEMO: dane trzymane są
// tylko w przeglądarce (localStorage), a do panelu admina logujesz się
// dowolnym loginem i hasłem "admin".
//
// Gdzie to znaleźć: Supabase → Project Settings → API
//   SUPABASE_URL      = "Project URL"
//   SUPABASE_ANON_KEY = klucz "anon" / "publishable" (jest publiczny, można go trzymać w repo;
//                        bezpieczeństwo zapewniają reguły RLS z pliku supabase/schema.sql)
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

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
