# Sim Sport Polska — strona ligi

Strona ligi sim racingowej: sekcja **Formuła 1** (wyniki, klasyfikacje, kalendarz, zespoły, profile kierowców),
miejsce na **Le Mans Ultimate** oraz **panel administratora** (wyniki, edycja, kary, sezony, kalendarz, zespoły, baza torów).

## Jak to działa

| Warstwa | Technologia | Koszt |
|---|---|---|
| Strona | Statyczne pliki HTML/JS (Preact + htm, bez kompilacji) | — |
| Baza danych + logowanie admina | [Supabase](https://supabase.com) (PostgreSQL) | darmowy plan |
| Hosting | GitHub Pages / Netlify / Cloudflare Pages | darmowe |

Strona nie potrzebuje własnego serwera: przeglądarka pobiera dane prosto z Supabase.
Czytać może każdy, a zapisywać tylko zalogowani administratorzy. Pilnują tego reguły RLS w bazie (`supabase/schema.sql`).

Punkty i klasyfikacje są liczone na bieżąco z surowych wyników i kar. Nałożenie albo cofnięcie kary od razu zmienia wynik
wyścigu i klasyfikację generalną.

## Podgląd lokalny (tryb demo)

Dopóki `js/config.js` jest pusty, strona działa w **trybie demo** na przykładowych danych zapisanych w przeglądarce.

```bash
python -m http.server 8000
```

Otwórz http://localhost:8000. Do panelu admina zalogujesz się dowolnym loginem i hasłem `admin`.
Uwaga: plik `index.html` otwarty bezpośrednio z dysku (file://) nie zadziała. Potrzebny jest serwer, choćby ten powyżej.

## Podłączenie bazy (Supabase), ok. 10 minut

1. Załóż konto na https://supabase.com i utwórz projekt (region: Frankfurt / `eu-central-1`).
2. **SQL Editor → New query**: wklej całą zawartość `supabase/schema.sql` i kliknij **Run**.
   Skrypt tworzy tabele, reguły bezpieczeństwa, magazyn grafik i startową bazę torów: 25 dla F1 oraz po 14 dla klas Hypercar, LMP i GT3.
3. **Dane startowe ligi**: w nowym zapytaniu SQL Editor wklej `supabase/seed.sql` i kliknij **Run**.
   Ładuje sezony 1–2 F1: 23 wyścigi, 451 wyników, 74 kierowców, zespoły i składy.
   **Działa jednorazowo**: zapisuje znacznik w tabeli `app_meta`, więc każde kolejne uruchomienie nic nie robi.
   Nie zdubluje danych, nie przywróci usuniętych i nie nadpisze zmian z panelu.
4. **Authentication → Users → Add user**: logowanie na stronie odbywa się **loginem**, więc jako e-mail wpisz
   `<login>@ssp.example.com` (np. `daniel@ssp.example.com`, na stronie logujesz się jako `daniel`). Ustaw hasło
   i zaznacz *Auto Confirm User*. Jeśli zapomnisz o tej opcji, logowanie zgłosi „Konto nie jest potwierdzone”.
   Wtedy w SQL Editor wykonaj `update auth.users set email_confirmed_at = now() where email = '<login>@ssp.example.com';`.
   Domenę zmienisz w `js/config.js` (`LOGIN_DOMAIN`). `example.com` nie przyjmuje
   poczty, więc nikt nie dostanie żadnych wiadomości. Pełny adres e-mail wpisany w polu logowania też działa.
5. Skopiuj **User UID** tego użytkownika i w SQL Editor wykonaj:
   ```sql
   insert into public.admins (user_id) values ('WKLEJ-UID');
   ```
   Kolejnych adminów dodajesz tak samo.
6. **Authentication → Sign In / Providers**: wyłącz *Allow new users to sign up*, żeby nikt obcy nie zakładał kont.
   Nawet bez tego obce konto nie mogłoby niczego zmienić, ale tak jest czyściej.
7. **Project Settings → API**: skopiuj *Project URL* i klucz *anon / publishable* do `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   Klucz anon jest publiczny z założenia i może trafić do repozytorium. **Nigdy** nie wklejaj tu klucza `service_role`.

Po podłączeniu baza zawiera tory i wyniki dwóch pierwszych sezonów. Kolejny sezon tworzysz w panelu admina.

### Dane startowe (`wyniki_ligi.json`)

`supabase/seed.sql` i `js/seed-data.js` (dane trybu demo) generuje skrypt z pliku `wyniki_ligi.json`:

```bash
python tools/build_seed.py
```

Po poprawkach w `wyniki_ligi.json` uruchom skrypt ponownie i jeszcze raz wykonaj `seed.sql`. Uwaga: przy ponownym
uruchomieniu istniejące rekordy nie są nadpisywane (`on conflict do nothing`), więc dla poprawionych danych najpierw
usuń sezon w panelu admina. Konwersja:

- „strata” w pliku to odstęp do poprzedniego auta, więc skrypt sumuje ją do straty względem zwycięzcy;
- całkowity czas wyścigu nie jest znany, dlatego zwycięzca ma na stronie opis „Zwycięzca”;
- skład startowy: w każdym zespole dwóch kierowców z największą liczbą startów, pozostali w rezerwie;
- w pliku nie ma dat wyścigów, liczby okrążeń, krajów ani numerów kierowców, więc te pola są puste
  i można je uzupełnić w panelu.

> Darmowy projekt Supabase jest wstrzymywany po ok. tygodniu bez żadnego ruchu. Przy aktywnej lidze to nie problem,
> a wstrzymany projekt wznowisz jednym kliknięciem w panelu Supabase.

### Szybkość ładowania

- Dane sezonu pobiera jedno zapytanie (funkcja `season_bundle` w bazie), a nie kilkanaście.
  **Po aktualizacji strony uruchom ponownie `supabase/schema.sql`**: to bezpieczne i doda brakującą funkcję.
  Bez niej strona działa, tylko wolniej (pobiera dane po staremu).
- Biblioteka Supabase jest w projekcie jako jeden plik (`vendor/supabase.js`, wersja 2.116.0), a `index.html`
  ma podpowiedzi `modulepreload`, więc przeglądarka pobiera wszystkie moduły równolegle.
  Po dodaniu nowego pliku w `js/` dopisz go do tej listy.
- Odczytane dane są trzymane w pamięci przez 5 minut. Każdy zapis w panelu admina czyści tę pamięć.

### Bezpieczeństwo danych i kont

- **Strona nie może skasować bazy.** Kod strony nie tworzy ani nie usuwa tabel. Ponowne wdrożenie na Vercelu
  nie dotyka bazy, a dane znikają tylko wtedy, gdy admin sam je usunie w panelu.
- **`schema.sql` można uruchamiać wielokrotnie.** Tylko tworzy brakujące elementy i nie zawiera poleceń
  usuwających tabele ani dane.
- **Konta adminów** są w Supabase Auth (hasła zaszyfrowane), a uprawnienia w tabeli `admins`.
  **Nie trzymaj kont ani haseł w plikach projektu ani w `.env`.** Strona działa w przeglądarce, więc wszystko,
  co do niej trafia, jest publiczne. Admina dodajesz w Supabase (*Authentication → Users*, a potem `insert into admins`).
- **`js/config.js`** zawiera tylko publiczny adres projektu i klucz `anon`. Zapis blokują reguły bezpieczeństwa (RLS).
  Klucz `service_role` nigdy nie trafia do projektu.
- **Kopia zapasowa**: Supabase → *Database → Backups*. W darmowym planie warto też co jakiś czas pobrać zrzut bazy.

## Hosting

**GitHub Pages:**
1. Utwórz repozytorium na GitHubie i wypchnij do niego zawartość tego folderu.
2. *Settings → Pages → Source: Deploy from a branch → `main` / root*.
3. Po minucie strona jest dostępna pod `https://<login>.github.io/<repo>/`.

**Netlify / Cloudflare Pages:** przeciągnij folder na stronę *Deploy* albo podłącz repozytorium.
Build command zostaw pusty, a jako katalog publikacji wskaż katalog główny.

Na każdym z tych hostingów możesz potem podpiąć własną domenę.

## Lokalny pre-prod (`preprod.bat`)

Kopia strony z **własną, lokalną bazą Supabase** (w Dockerze) — do testowania zmian bez ryzyka dla produkcji.

- Wymaga **Docker Desktop** (https://www.docker.com/products/docker-desktop/ albo `winget install Docker.DockerDesktop`) i Pythona.
  Supabase CLI pobiera się samo do `tools/bin` (bez Node.js).
- `preprod.bat` → menu: **Start** (baza + strona na http://localhost:8000), **Stop**, **Reset** (czyści lokalną bazę i wgrywa dane od nowa), **Status**.
- Lokalna baza dostaje: `supabase/schema.sql` → `supabase/seed.sql` (sezony F1) → konto admina **admin / admin** (`supabase/local/admin.sql`).
  Konfiguracja: `supabase/config.toml`. Panel bazy (Studio): http://127.0.0.1:54323.
- Po starcie powstaje `js/config.local.js` — strona otwierana na `localhost` łączy się wtedy z lokalną bazą.
  „Stop” usuwa ten plik, więc podgląd lokalny (`python tools/serve.py`) znów korzysta z produkcji. Plik nie trafia do repozytorium ani na Vercel.
- Produkcja nie jest w żaden sposób używana: projekt nie jest „podlinkowany” z Supabase w chmurze.
- Za pierwszym razem start trwa kilka minut (Docker pobiera obrazy, kilka GB); kolejne — kilkanaście sekund. Dane lokalne zostają między uruchomieniami.

## Logowanie przez Discord

Kierowcy logują się kontem Discord (link **Zaloguj** w nagłówku → `#/konto`). Admini mogą dalej używać loginu i hasła.

**Jak działa:**
- pierwsze logowanie: jeśli w bazie jest kierowca z takim samym nickiem (bez konta), powstaje **prośba o powiązanie** — admin zatwierdza ją w *Panel → Baza danych → Konta Discord*; w przeciwnym razie automatycznie powstaje **nowy kierowca** z nickiem z Discorda,
- kierowca, który startował pod innym nickiem, może na stronie *Moje konto* wskazać swój stary profil (prośba do admina),
- admin może powiązać dowolnego kierowcę z kontem Discord (kolumna *Discord* w bazie kierowców albo karta *Konta Discord*); profil założony automatycznie zostaje wtedy **scalony** z wybranym kierowcą — wyniki, składy i kary przechodzą na niego,
- po powiązaniu nick i awatar kierowcy są odświeżane z Discorda przy każdym logowaniu (nazwa wyświetlana na Discordzie).

**Konfiguracja (jednorazowo):**
1. Supabase → SQL Editor: uruchom `supabase/migrations/2026-10-30_discord.sql` (nic nie kasuje).
2. https://discord.com/developers/applications → *New Application* (np. „Sim Sport Polska”) → zakładka **OAuth2**:
   skopiuj **Client ID**, kliknij *Reset Secret* i skopiuj **Client Secret**, w *Redirects* dodaj
   `https://<id-projektu>.supabase.co/auth/v1/callback` i zapisz.
3. Supabase → *Authentication → Sign In / Providers → Discord*: włącz, wklej Client ID i Client Secret, zapisz.
   (Sekret wpisujesz **tylko tutaj** — nigdy w plikach strony ani w repozytorium.)
4. Supabase → *Authentication → URL Configuration*: **Site URL** = adres strony (np. `https://twoja-strona.vercel.app`),
   w **Redirect URLs** dodaj adres strony oraz `http://localhost:8000` (podgląd lokalny).

Admin z kontem Discord: zaloguj się raz przez Discord, a potem w SQL Editor nadaj uprawnienia
(`insert into admins (user_id) values ('<id z ekranu „Brak uprawnień”>');`).

## Rangi użytkowników

| Ranga | Dostęp |
|---|---|
| **Konto główne** (login `admin`, e-mail `admin@ssp.example.com`) | zawsze admin; jego rangi nie da się zmienić |
| **Admin** | pełny dostęp: zarządzanie ligą + rangi użytkowników (*Panel → Użytkownicy*) + konta Discord |
| **Moderator** | zarządzanie ligą: sezony, kalendarz, zespoły, składy, wyniki i czasy, kary, kierowcy, tory, Endurance, grafiki |
| **Użytkownik** | domyślnie każde nowe konto (np. z Discorda) — bez dostępu do panelu |

Rangi są sprawdzane w bazie (reguły RLS), a nie tylko na stronie — nie da się ich obejść z przeglądarki.
Admin nie może zmienić własnej rangi ani rangi konta głównego, więc nikt przypadkiem nie odetnie wszystkich od panelu.
Aktualizacja bazy: `supabase/migrations/2026-10-30_rangi.sql` (dotychczasowi admini z tabeli `admins` zostają adminami).

## Panel administratora (`#/admin`)

Panel ma cztery zakładki: **Formuła 1**, **LMU Liga**, **LMU Endurance** i **Baza danych**. W bazie są tory i kierowcy,
czyli dane wspólne dla wszystkich sezonów.

W serii wybierasz sezon (albo tworzysz nowy) i widzisz **oś sezonu z kafelkami**:

```
[ Start sezonu ] → [ R1 ] → [ R2 ] → … → [ R12 ]
```

**Start sezonu** ma kroki:
1. **Ustawienia**: nazwa, punktacja, typ sezonu (LMU: Liga / Endurance).
2. **Kalendarz**: wyścigi z torów z bazy.
3. **Zespoły**: nazwa, kolor, logo i bolid na ten sezon. Można skopiować zespoły z poprzedniego sezonu.
4. **Składy startowe**: kto w jakim zespole, kto w rezerwie.

**Kafelek wyścigu** ma kroki:
1. **Wyniki**: formularz od razu zawiera skład obowiązujący w tej rundzie. Kolejność ustawiasz numerem w kolumnie *Poz*.
   Można też wkleić wyniki z tekstu w formacie `Nick | Zespół | P. startowa | Pit | Najlepsze okrążenie | Czas`.
2. **Kary**: czasowe, punktowe, DSQ, na starcie, ostrzeżenia. Widać podgląd „przed / po”.
3. **Zmiany w składach**: zamiany i przejścia do rezerwy obowiązujące **od następnej rundy**.
4. **Zatwierdzenie**: podsumowanie, a po zatwierdzeniu publikacja wyników na stronie i przejście do kolejnej rundy.

Stany kafelków: *Zaplanowany*, *Następny*, *Do zatwierdzenia* (są wyniki, ale nie są opublikowane), *Zatwierdzony*.
Kary i składy można poprawiać także po zatwierdzeniu.

## Zespoły w sezonie

Zespoły tworzysz osobno dla każdego sezonu (*Start sezonu → Zespoły*). Formularz zespołu ma pola:

- **nazwa** obowiązująca w tym sezonie;
- **kolor**;
- **logo**;
- **profil bolidu**;
- **klasa** (tylko w LMU).

Wyniki wskazują na zespół z danego sezonu, więc stare wyścigi zawsze pokazują nazwę i barwy z tamtego czasu.
Zmiana nazwy albo grafiki w nowym sezonie nie zmienia poprzednich sezonów.

**Grafiki wgrywasz plikiem** przyciskiem „Wgraj plik” (PNG, JPG albo WebP, najlepiej z przezroczystym tłem). Strona sama
zmniejsza obrazek (logo do 256 px, bolid do 900 px szerokości) i zapisuje go jako lekki plik WebP:

- przy podłączonym Supabase pliki trafiają do magazynu plików **Storage** (bucket `images` tworzony przez `schema.sql`),
  a przy zespole zapisuje się adres pliku;
- w trybie demo obrazek zapisuje się w przeglądarce.

Szybki start sezonu jest opcjonalny: „Szablon: 11 zespołów F1 2026” (gotowe grafiki z `assets/teams/`)
albo „skopiuj zespoły i składy z sezonu…”, a potem zmieniasz nazwy i grafiki.

## Rotacje kierowców (skład i rezerwa)

Każdy wynik pamięta zespół, w barwach którego został zdobyty. Dzięki temu po zmianie składu:

- **punkty zespołu się nie zmieniają**, bo liczą się z wyników, a nie z aktualnego składu;
- **punkty indywidualne idą za kierowcą**;
- w klasyfikacji kierowca przesunięty do rezerwy ma oznaczenie **„Rezerwa”** i listę zespołów, dla których punktował.

Skład zapisany jest **na każdą rundę**: skład startowy plus zmiany wprowadzone po kolejnych wyścigach.
Zmianę robisz w kafelku wyścigu, w kroku *Zmiany w składach*, i obowiązuje ona od następnej rundy. Cofnięcie zmiany przywraca poprzedni skład. Wpis trafia do rejestru zmian i jest widoczny na stronie zespołu. Strona odróżnia wtedy
„byłego kierowcę” od jednorazowego „zastępstwa”. Jednorazowe zastępstwo nie wymaga zmiany składu: w formularzu wyników
wybierasz rezerwowego i zespół, za który jechał.

## Tory

Baza torów jest w *Baza danych → Tory*. Każdy tor należy do **jednej kategorii samochodu**: F1, Hypercar, LMP albo GT3.
Ten sam obiekt (np. Spa) występuje osobno w każdej kategorii, z własnymi materiałami:

- **nitka toru**: obrazek wgrywany plikiem (najlepiej PNG z przezroczystym tłem);
- **film z przejazdu**: link do YouTube (`watch?v=`, `youtu.be/`, `shorts/` i inne formaty). Strona sama go rozpoznaje.

Dzięki temu sezon F1 widzi w kalendarzu tylko tory F1 i nigdy nie pokaże przejazdu GT3. Sezon LMU widzi tory klas
Hypercar / LMP / GT3. Przycisk „Kopiuj do kategorii…” tworzy ten sam tor w innej kategorii, bez obrazka i filmu.
Nitka toru i film pojawiają się na stronie wyścigu, a miniatura nitki także w kalendarzu. Film ładuje się dopiero
po kliknięciu.

## Le Mans Ultimate

**Liga LMU** działa jak F1 (oś sezonu, kafelki wyścigów), z jedną różnicą: w ustawieniach sezonu wybierasz
**klasy jadące w sezonie** (1–3: Hypercar / LMP / GT3). W jednym wyścigu może jechać kilka klas naraz, a mimo to:

- wyniki wyścigu i klasyfikacja kierowców są **osobne dla każdej klasy** (na stronie przełącznik „Klasa”
  nad zakładkami). W lidze LMU nie ma klasyfikacji zespołów;
- formularz wyników pokazuje tylko klasy z danego sezonu. Przy jednej klasie ustawia się ona sama.

W lidze LMU **zamiast zespołów są samochody**, bo liczy się marka i model auta, a nie zespół:

- *Start sezonu → Samochody*: modele aut jeżdżące w sezonie (marka i model, klasa, kolor, logo marki, zdjęcie auta).
  Model można wybrać z listy aut Le Mans Ultimate albo wpisać ręcznie;
- *Start sezonu → Przypisanie aut*: każdemu kierowcy przypisujesz auto. **Jednym modelem może jechać dowolnie wielu kierowców**;
- *kafelek wyścigu → Zmiany aut*: zmiana auta kierowcy od kolejnej rundy. Wcześniejsze wyniki zostają przy aucie,
  którym zostały zdobyte;
- na stronie zakładka **Samochody** (auta z kierowcami), a w tabelach kolumna „Samochód”.

W bazie samochody LMU są zapisane w tej samej tabeli co zespoły F1 (`teams`), więc wyniki i historia działają tak samo.

**Endurance** (*panel → LMU Endurance*) to moduł informacyjny o wyścigach długodystansowych:

- **event**: nazwa, tor (tory klas LMU), start, długość w godzinach, link do transmisji lub powtórki, status;
- w evencie **dowolna liczba zespołów Sim Sport Polska**, każdy z klasą, numerem, modelem auta,
  **zdjęciem auta** (wgrywane plikiem) i składem kierowców z bazy;
- po wyścigu wpisujesz wynik każdego zespołu (status, miejsce w klasie, miejsce ogólne, okrążenia, komentarz)
  i oznaczasz event jako zakończony.

Strona *Le Mans Ultimate* ma dwie główne zakładki:

- **Liga**: Klasyfikacja · Wyniki · Kalendarz · Samochody;
- **Endurance**: Kalendarz (zaplanowane eventy) · Wyniki (zakończone). Każdy event można rozwinąć, żeby zobaczyć
  nitkę toru i film z przejazdu **w wersji dla klasy każdego zespołu**.

**Strona główna** ma dwie kolumny:

- po lewej **Nadchodzące wydarzenia** ze wszystkich serii (F1, liga LMU, Endurance), posortowane po dacie.
  Kliknięcie otwiera kalendarz na danym wyścigu, a event Endurance od razu się rozwija;
- po prawej **wyniki bieżących sezonów**: F1 (kierowcy i konstruktorzy) oraz liga LMU (kierowcy w każdej klasie).

## Klasy samochodów

Każdy wynik ma klasę: **F1, GT3, LMP lub HY** (Hypercar). W sezonach F1 klasa jest zawsze F1. W sezonach LMU
zespół ma przypisaną klasę, a formularz wyników podpowiada ją automatycznie. Pozycje, punkty, pole i najszybsze
okrążenie liczone są osobno w każdej klasie. Profil kierowcy (`#/kierowca/<id>`) jest wspólny dla wszystkich serii
i pokazuje statystyki łącznie albo w podziale na klasy.

## Struktura

```
index.html
css/style.css
assets/              logo, grafika
vendor/preact-htm.js Preact + htm (lokalna kopia)
js/
  config.js          ← konfiguracja Supabase
  app.js             router i układ strony
  db.js / db-local.js  warstwa danych (Supabase / tryb demo)
  scoring.js         punktacja, kary, klasyfikacje
  ui.js              wspólne komponenty
  pages/             strony publiczne (start, F1, LMU)
  admin/             zakładki panelu admina
supabase/schema.sql  schemat bazy + reguły + tory
```

## Dalsze kroki

- Liga LMU: załogi kilku kierowców w jednym aucie (dziś jeden wynik = jeden kierowca).
- Kwalifikacje jako osobna sesja, galeria, regulamin, newsy.
