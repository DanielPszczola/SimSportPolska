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

Otwórz http://localhost:8000. Do panelu admina zalogujesz się dowolnym e-mailem i hasłem `admin`.
Uwaga: plik `index.html` otwarty bezpośrednio z dysku (file://) nie zadziała. Potrzebny jest serwer, choćby ten powyżej.

## Podłączenie bazy (Supabase), ok. 10 minut

1. Załóż konto na https://supabase.com i utwórz projekt (region: Frankfurt / `eu-central-1`).
2. **SQL Editor → New query**: wklej całą zawartość `supabase/schema.sql` i kliknij **Run**.
   Skrypt tworzy tabele, reguły bezpieczeństwa, magazyn grafik i startową bazę torów: 25 dla F1 oraz po 14 dla klas Hypercar, LMP i GT3.
3. **Dane startowe ligi**: w nowym zapytaniu SQL Editor wklej `supabase/seed.sql` i kliknij **Run**.
   Ładuje sezony 1–2 F1: 23 wyścigi, 451 wyników, 74 kierowców, zespoły i składy.
   Skrypt można bezpiecznie uruchomić ponownie, bo niczego nie dubluje.
4. **Authentication → Users → Add user**: podaj e-mail i hasło admina, zaznacz *Auto Confirm User*.
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

## Hosting

**GitHub Pages:**
1. Utwórz repozytorium na GitHubie i wypchnij do niego zawartość tego folderu.
2. *Settings → Pages → Source: Deploy from a branch → `main` / root*.
3. Po minucie strona jest dostępna pod `https://<login>.github.io/<repo>/`.

**Netlify / Cloudflare Pages:** przeciągnij folder na stronę *Deploy* albo podłącz repozytorium.
Build command zostaw pusty, a jako katalog publikacji wskaż katalog główny.

Na każdym z tych hostingów możesz potem podpiąć własną domenę.

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
