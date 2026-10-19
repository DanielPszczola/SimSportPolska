import { html, render, useState, useEffect } from '../vendor/preact-htm.js';
import { db } from './db.js';
import { Toasts } from './ui.js';
import { LEAGUE_NAME } from './config.js';
import { HomePage } from './pages/home.js';
import { F1Section, LmuSection } from './pages/league.js';
import { DriverPage } from './pages/driver.js';
import { AdminPage } from './admin/admin.js';

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const fn = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  return route;
}

function Header({ section }) {
  const [open, setOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => setOpen(false), [section]);
  // dyskretny link: „Zaloguj” dla gości, „Panel” po zalogowaniu (sprawdzane przy każdej zmianie sekcji)
  useEffect(() => { db.auth.user().then((u) => setLoggedIn(!!u)).catch(() => setLoggedIn(false)); }, [section]);
  const link = (href, id, label) => html`<a href=${href} class=${section === id ? 'active' : ''} onClick=${() => setOpen(false)}>${label}</a>`;
  return html`<header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="#/"><img src="assets/logo.png" alt=${LEAGUE_NAME} /></a>
      <button class="burger" aria-label="Menu" aria-expanded=${open} onClick=${() => setOpen(!open)}><span></span><span></span><span></span></button>
      <nav class=${open ? 'open' : ''}>
        ${link('#/', '', 'Strona główna')}
        ${link('#/f1', 'f1', 'Formuła 1')}
        ${link('#/lmu', 'lmu', 'Le Mans Ultimate')}
        <a href="#/admin" class=${`nav-admin ${section === 'admin' ? 'active' : ''}`} title="Panel administratora">${loggedIn ? 'Panel' : 'Zaloguj'}</a>
      </nav>
    </div>
  </header>`;
}

function DemoBanner() {
  if (db.mode !== 'demo') return null;
  return html`<div class="demo-banner">
    <b>TRYB DEMO</b> — dane zapisują się tylko w tej przeglądarce. Admin: dowolny e-mail, hasło <code>admin</code>.
    Podłącz Supabase w <code>js/config.js</code> (instrukcja w README).
    <button class="link" onClick=${() => confirm('Przywrócić przykładowe dane demo? Twoje zmiany zostaną utracone.') && db.reset()}>Resetuj dane demo</button>
  </div>`;
}

function App() {
  const { parts, query } = useRoute();
  const [section = '', ...rest] = parts;
  let page;
  if (!section) page = html`<${HomePage} />`;
  else if (section === 'f1') page = html`<${F1Section} parts=${rest} query=${query} />`;
  else if (section === 'lmu') page = html`<${LmuSection} parts=${rest} />`;
  else if (section === 'kierowca') page = html`<${DriverPage} driverId=${rest[0]} />`;
  else if (section === 'admin') page = html`<${AdminPage} parts=${rest} />`;
  else page = html`<div class="wrap page"><h1>404</h1><p>Nie ma takiej strony. <a href="#/">Wróć na start</a></p></div>`;

  return html`
    <${DemoBanner} />
    <${Header} section=${section} />
    <main>${page}</main>
    <footer class="site-footer"><div class="wrap">© ${new Date().getFullYear()} ${LEAGUE_NAME} · Liga sim racingowa</div></footer>
    <${Toasts} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));
