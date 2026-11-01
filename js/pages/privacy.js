import { html } from '../ui.js';
import { LEAGUE_NAME, DISCORD_INVITE } from '../config.js';

// Polityka prywatności (RODO): co strona zbiera, po co, komu przekazuje i jak usunąć swoje dane.
// Przy zmianie zasad przetwarzania (nowe dane, nowy dostawca) zaktualizuj tekst i datę.

const UPDATED = '1 listopada 2026';

/** Krótka informacja przy logowaniu przez Discord. */
export function PrivacyNote({ text = 'Logując się przez Discord, przekazujesz nam podstawowe dane konta Discord.' }) {
  return html`<p class="privacy-note muted small">${text} <a href="#/prywatnosc">Polityka prywatności</a></p>`;
}

export function PrivacyPage() {
  const discord = html`<a href=${DISCORD_INVITE} target="_blank" rel="noopener">serwer Discord ligi</a>`;
  return html`<div class="wrap page narrow privacy">
    <div class="page-head"><h1>Polityka prywatności</h1></div>
    <p class="muted">Aktualizacja: ${UPDATED}</p>

    <h2>Kto przetwarza dane</h2>
    <p>Administratorem danych jest liga <b>${LEAGUE_NAME}</b>. Kontakt w sprawach danych osobowych: wiadomość do administracji ligi
      na ${discord}.</p>

    <h2>Przeglądanie strony</h2>
    <p>Do przeglądania strony nie trzeba się logować i nie zbieramy wtedy żadnych danych. Strona nie używa narzędzi analitycznych,
      reklam ani ciasteczek śledzących. Firmy, które utrzymują stronę i bazę danych (patrz niżej), zapisują techniczne logi połączeń
      (m.in. adres IP i rodzaj przeglądarki) na potrzeby bezpieczeństwa i przez krótki czas.</p>
    <p>W przeglądarce zapisujemy tylko to, co jest niezbędne do działania strony: sesję logowania, ostatnio wybrany sezon
      i losowy identyfikator potrzebny do głosowania na kierowcę dnia. Te dane nie opuszczają Twojego urządzenia poza
      zwykłym korzystaniem z tych funkcji, dlatego strona nie wyświetla banera zgody na ciasteczka.</p>

    <h2>Konto Discord</h2>
    <p>Logując się przez Discord, przekazujesz nam z Discorda: <b>identyfikator konta, nazwę użytkownika, nazwę wyświetlaną, awatar</b> oraz <b>adres e-mail</b>. Adres e-mail zapisuje usługa logowania — nie wykorzystujemy go i nie jest widoczny dla administracji ligi.
      Zapisujemy też daty logowania.</p>
    <p>Cel: konto na stronie i powiązanie go z Twoim profilem kierowcy (nick i awatar są pobierane z Discorda).
      Podstawa: art. 6 ust. 1 lit. b RODO — korzystasz z konta na własne żądanie, żeby brać udział w lidze.</p>

    <h2>Profil kierowcy i wyniki (publiczne)</h2>
    <p>Na stronie publicznie widoczne są: nick, awatar, kraj i numer startowy kierowcy, a także wyniki, kary, składy zespołów
      i klasyfikacje. Cel: prowadzenie ligi i archiwum jej rozgrywek. Podstawa: art. 6 ust. 1 lit. f RODO — prawnie uzasadniony
      interes ligi (historia wyników).</p>

    <h2>Zgłoszenia do sezonów i wydarzeń</h2>
    <p>Wysyłając zgłoszenie przez formularz w ogłoszeniu, przekazujesz odpowiedzi na pytania z formularza. Widzi je tylko
      administracja ligi (moderatorzy i administratorzy). Cel: nabór kierowców. Podstawa: art. 6 ust. 1 lit. b RODO.
      Zgłoszenia są usuwane automatycznie 30 dni po zakończeniu zapisów (przyjęci kierowcy zostają w składzie sezonu).
      Do końca zapisów możesz zgłoszenie poprawić albo wycofać.</p>
    <p>Jeśli ogłoszenie prowadzi do zewnętrznego formularza (np. Google Forms), dane podajesz w tamtym serwisie, na jego zasadach.</p>

    <h2>Głosowanie na kierowcę dnia</h2>
    <p>Głosować może każdy. Żeby jedna osoba nie głosowała wielokrotnie, zapisujemy: na kogo oddano głos, losowy identyfikator
      przeglądarki (albo konto, jeśli jesteś zalogowany) oraz <b>skrót adresu IP</b> (nie sam adres) — limit głosów z jednej sieci.
      Skrót adresu IP usuwamy po zakończeniu głosowania. Podstawa: art. 6 ust. 1 lit. f RODO — uczciwość głosowania.</p>

    <h2>Komu przekazujemy dane</h2>
    <ul>
      <li><b>Supabase</b> — baza danych i logowanie (serwery w Unii Europejskiej);</li>
      <li><b>Vercel</b> — hosting strony;</li>
      <li><b>Discord</b> — logowanie; awatary wyświetlają się z serwerów Discorda;</li>
      <li><b>YouTube (Google)</b> — transmisje: odtwarzacz w kafelku trwającego wydarzenia na stronie głównej i filmy z przejazdu toru
        (te ładują się dopiero po kliknięciu) łączą się z YouTube, który otrzymuje adres IP i może zapisywać dane w przeglądarce
        według zasad Google. Przyciski do Twitcha, TikToka i Discorda to zwykłe linki.</li>
    </ul>
    <p>Część tych firm ma siedzibę w USA. Dane trafiają tam na podstawie programu EU-US Data Privacy Framework
      albo standardowych klauzul umownych zatwierdzonych przez Komisję Europejską. Nie sprzedajemy danych i nie przekazujemy ich nikomu innemu.</p>

    <h2>Jak długo przechowujemy dane</h2>
    <ul>
      <li>konto Discord — do czasu, aż je odepniesz (albo poprosisz o usunięcie);</li>
      <li>profil kierowcy i wyniki — przez czas istnienia ligi, jako archiwum rozgrywek;</li>
      <li>zgłoszenia — 30 dni po zakończeniu zapisów, potem są usuwane automatycznie;</li>
      <li>skrót adresu IP z głosowania — do zakończenia głosowania.</li>
    </ul>

    <h2>Twoje prawa</h2>
    <p>Masz prawo do dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przeniesienia oraz sprzeciwu
      wobec przetwarzania opartego na uzasadnionym interesie. Napisz do administracji ligi na ${discord}.
      Masz też prawo złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych (<a href="https://uodo.gov.pl" target="_blank" rel="noopener">uodo.gov.pl</a>).</p>

    <h2>Usunięcie konta</h2>
    <p>W <a href="#/konto">Moje konto</a> możesz w każdej chwili kliknąć <b>„Odepnij konto Discord”</b>. Usuwa to konto na stronie
      i wszystkie dane z Discorda (identyfikator, nazwy, e-mail, awatar) oraz Twoje zgłoszenia. Profil kierowcy z nickiem i wynikami
      zostaje jako część historii ligi. Jeśli chcesz, żeby z wyników zniknął także Twój nick, wyślij do administracji ligi prośbę
      o jego zmianę — zastąpimy go neutralnym (np. „Kierowca #57”). Wyniki i klasyfikacje się przy tym nie zmieniają.</p>
  </div>`;
}
