-- =====================================================================
-- Sim Sport Polska — schemat bazy danych (Supabase / PostgreSQL)
-- Uruchom całość w: Supabase → SQL Editor → New query → Run
--
-- BEZPIECZNY DO PONOWNEGO URUCHOMIENIA: plik tylko tworzy brakujące elementy
-- (create ... if not exists, wstawianie tylko do pustych tabel). Nie zawiera
-- poleceń usuwających tabele ani dane — ponowne uruchomienie niczego nie kasuje.
-- =====================================================================

-- ---------- administratorzy ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- rangi: admin / moderator / użytkownik (+ konto główne „admin”) ----------
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'moderator', 'user')),
  updated_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;
drop policy if exists "read own role" on public.user_roles;
create policy "read own role" on public.user_roles for select to authenticated using (user_id = auth.uid());
-- (zmiana rang wyłącznie przez funkcję set_user_role — tylko admin)

-- dotychczasowi administratorzy (tabela admins) zachowują uprawnienia jako „admin”
insert into public.user_roles (user_id, role) select user_id, 'admin' from public.admins on conflict (user_id) do nothing;

create or replace function public.is_owner()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from auth.users where id = auth.uid() and lower(email) = 'admin@ssp.example.com');
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_owner() or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin() or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'moderator');
$$;

-- ranga zalogowanego: 'owner' | 'admin' | 'moderator' | 'user' (null dla niezalogowanych)
create or replace function public.my_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when public.is_owner() then 'owner'
    else coalesce((select role from public.user_roles where user_id = auth.uid()), 'user')
  end;
$$;
grant execute on function public.is_owner() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.my_role() to anon, authenticated;

-- ---------- tory ----------
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  country_code text,             -- ISO 3166-1 alpha-2, np. 'PL' (flaga)
  length_km numeric(6, 3),
  -- każdy tor należy do jednej kategorii samochodu; ten sam obiekt dla F1 i GT3 to dwa osobne wpisy
  category text not null default 'F1' check (category in ('F1', 'GT3', 'LMP', 'HY')),
  layout_url text,                       -- obrazek z nitką toru (Supabase Storage, bucket images)
  video_url text,                        -- film z przykładowym przejazdem (YouTube)
  created_at timestamptz not null default now()
);

-- ---------- sezony ----------
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  series text not null default 'f1' check (series in ('f1', 'lmu', 'inne')),  -- 'inne' = wydarzenia i serie z zakładki Inne
  name text not null,
  is_current boolean not null default false,
  points int[] not null default '{25,18,15,12,10,8,6,4,2,1}',
  fl_point int not null default 1,       -- punkty za najszybsze okrążenie
  fl_top10 boolean not null default true, -- NO punktowane tylko w TOP 10
  pole_point int not null default 0,
  finish_bonus int not null default 0,   -- bonus za ukończenie wyścigu
  format text not null default 'league' check (format in ('league', 'endurance')),  -- (nieużywane, zostawione dla zgodności)
  classes text[] not null default '{HY,LMP,GT3}',  -- LMU: klasy jadące w sezonie (1–3); F1 ignoruje
  -- punkty konstruktorów: 'final' (domyślnie, wg regulaminu) = suma punktów kierowców z końcowego składu zespołu,
  --                       'lineup' = za zespół ze składu w danej rundzie, 'result' = za zespół wpisany przy wyniku
  team_points text not null default 'final' check (team_points in ('lineup', 'final', 'result')),
  -- wydarzenia „Inne”: format, tryb składów (zespoły jak F1 / auta z klasami jak LMU), własne klasy, opis
  event_format text not null default 'series' check (event_format in ('series', 'single')),
  roster_mode text not null default 'teams' check (roster_mode in ('teams', 'cars')),
  class_defs jsonb not null default '[]'::jsonb,  -- [{id, label, color}] — nazwa klasy jest jej identyfikatorem
  description text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- zespoły w sezonie: nazwa, barwy i grafiki obowiązujące w danym sezonie ----------
-- Wyniki wskazują na zespół w sezonie, więc historia zawsze pokazuje nazwę i barwy z tamtego czasu.
-- W lidze LMU wiersz oznacza SAMOCHÓD (marka/model, klasa, logo marki, zdjęcie auta), a entries = przypisanie auta kierowcy.
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text not null,
  color text,
  logo_url text,                         -- adres pliku (Supabase Storage, bucket images)
  car_url text,                          -- profil bolidu w tym sezonie
  car_class text check (char_length(car_class) <= 24),  -- LMU / „Inne”: klasa auta (F1, GT3, LMP, HY albo własna klasa wydarzenia)
  created_at timestamptz not null default now()
);

-- ---------- kierowcy (wspólni dla wszystkich sezonów) ----------
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  nick text not null unique,
  country_code text,
  number int,
  created_at timestamptz not null default now()
);

-- ---------- składy: kierowca w zespole w danym sezonie ----------
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  is_reserve boolean not null default false,
  created_at timestamptz not null default now(),
  unique (season_id, driver_id)
);

-- ---------- rejestr zmian w składach (rotacje kierowców) ----------
-- Tylko informacja "kto, za kogo, od której rundy". Wyniki się nie zmieniają: punkty zespołu
-- liczą się z wyników (results.team_id), a punkty indywidualne idą za kierowcą.
create table if not exists public.roster_changes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  driver_out_id uuid references public.drivers (id) on delete set null,  -- schodzi do rezerwy
  driver_in_id uuid references public.drivers (id) on delete set null,   -- wchodzi do zespołu
  from_round int not null,
  note text default '',
  created_at timestamptz not null default now()
);

-- ---------- LMU Endurance: wyścigi długodystansowe (moduł informacyjny) ----------
create table if not exists public.endurance_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- np. "24h Le Mans"
  track_id uuid references public.tracks (id) on delete set null,
  start_at timestamptz,
  duration_hours numeric(5, 2),          -- długość wyścigu w godzinach
  stream_url text,                       -- transmisja na żywo / powtórka (np. YouTube)
  status text not null default 'scheduled' check (status in ('scheduled', 'finished')),
  notes text default '',
  created_at timestamptz not null default now()
);

-- garaż: skonfigurowane auta (model, klasa, zdjęcie w malowaniu ligowym) do wyboru przy zespołach eventu
create table if not exists public.endurance_cars (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- np. "Porsche 963"
  car_class text check (car_class in ('HY', 'LMP', 'GT3')),
  image_url text,                        -- zdjęcie auta w malowaniu ligowym (Supabase Storage, bucket images)
  created_at timestamptz not null default now()
);

-- zespoły Sim Sport Polska w danym evencie (w jednym evencie może jechać kilka zespołów)
create table if not exists public.endurance_crews (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.endurance_events (id) on delete cascade,
  name text not null,                    -- np. "Sim Sport Polska #1"
  car_class text check (car_class in ('HY', 'LMP', 'GT3')),
  car_number text,
  car_model text,                        -- np. "Porsche 963"
  car_image_url text,                    -- zdjęcie auta w malowaniu ligowym (Supabase Storage, bucket images)
  car_id uuid references public.endurance_cars (id) on delete set null,  -- auto z garażu (model/klasa/zdjęcie kopiowane do zespołu)
  driver_ids uuid[] not null default '{}',
  result_status text check (result_status in ('FIN', 'DNF', 'DSQ', 'DNS')),
  position_class int,
  position_overall int,
  laps int,
  result_note text default '',
  hall_of_fame boolean not null default false,  -- admin: pokaż ten wynik w Galerii sław
  created_at timestamptz not null default now()
);

-- ---------- kalendarz ----------
create table if not exists public.races (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  round int not null,
  track_id uuid not null references public.tracks (id) on delete restrict,
  race_date timestamptz,
  laps int,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed')),
  counts boolean not null default true,  -- czy liczy się do klasyfikacji
  weather text,                          -- liga LMU: pogoda ustawiona w grze (js/race-conditions.js → WEATHER)
  game_time text,                        -- liga LMU: pora dnia w grze, godzina startu "HH:MM" (nie termin zawodów)
  kind text not null default 'race' check (kind in ('race', 'sprint')),  -- 'sprint' = sprint w tej samej rundzie co wyścig główny (punkty 8-1)
  notes text default '',
  created_at timestamptz not null default now()
);

-- ---------- wyniki (surowe, przed karami) ----------
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete restrict,
  team_id uuid references public.teams (id) on delete set null,
  car_class text check (char_length(car_class) <= 24),  -- klasa samochodu w tym wyścigu (także własne klasy wydarzeń „Inne”)
  position int not null,                 -- kolejność na mecie
  grid int,
  status text not null default 'FIN' check (status in ('FIN', 'DNF', 'DNS', 'DSQ', 'NC')),
  laps_down int not null default 0,
  time_ms bigint,                        -- całkowity czas wyścigu
  best_lap_ms int,
  fastest_lap boolean not null default false,
  pit_stops int,
  created_at timestamptz not null default now(),
  unique (race_id, driver_id)
);

-- ---------- kary ----------
create table if not exists public.penalties (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  type text not null check (type in ('time', 'points', 'dsq', 'grid', 'warning')),
  value numeric not null default 0,      -- sekundy / punkty / pozycje
  reason text default '',
  created_at timestamptz not null default now()
);

-- ---------- Inne: open lobby (luźne jazdy z transmisją, bez zapisów i wyników) ----------
create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  game text default '',                  -- np. "Le Mans Ultimate"
  cars text default '',                  -- np. "GT3"
  start_at timestamptz,
  duration_minutes int default 120,      -- „Trwa teraz” od startu przez tyle minut
  description text default '',
  youtube_url text,
  twitch_url text,
  tiktok_url text,
  discord_url text,                      -- link do kanału / zaproszenie
  status text not null default 'auto' check (status in ('auto', 'live', 'ended')),  -- auto = wg godziny startu
  created_at timestamptz not null default now()
);

-- ---------- ogłoszenia na stronie głównej (moderator i wyżej) ----------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  image_url text,                        -- Supabase Storage, bucket images
  pinned boolean not null default false,
  author text,                           -- nick autora w chwili publikacji
  created_at timestamptz not null default now()
);

-- ---------- znaczniki jednorazowych operacji (np. czy wgrano już dane startowe z seed.sql) ----------
create table if not exists public.app_meta (
  key text primary key,
  value text,
  created_at timestamptz not null default now()
);
alter table public.app_meta enable row level security;  -- brak polityk = strona nie ma do niej dostępu

create index if not exists teams_season_idx on public.teams (season_id);
create index if not exists entries_season_idx on public.entries (season_id);
create index if not exists races_season_idx on public.races (season_id);
create index if not exists roster_changes_season_idx on public.roster_changes (season_id);
create index if not exists results_race_idx on public.results (race_id);
create index if not exists results_driver_idx on public.results (driver_id);
create index if not exists penalties_race_idx on public.penalties (race_id);
create index if not exists endurance_crews_event_idx on public.endurance_crews (event_id);
create index if not exists lobbies_start_idx on public.lobbies (start_at);
create index if not exists posts_created_idx on public.posts (created_at);
-- dodanie kolumny do bazy utworzonej wcześniejszą wersją tego pliku (bezpieczne)
alter table public.endurance_crews add column if not exists hall_of_fame boolean not null default false;
alter table public.races add column if not exists weather text;
alter table public.races add column if not exists game_time text;
alter table public.endurance_crews add column if not exists car_id uuid references public.endurance_cars (id) on delete set null;
alter table public.seasons add column if not exists team_points text not null default 'final' check (team_points in ('lineup', 'final', 'result'));
alter table public.races add column if not exists kind text not null default 'race' check (kind in ('race', 'sprint'));
-- transmisje i czas trwania wyścigów (to samo co supabase/migrations/2026-11-01_transmisje.sql)
alter table public.races add column if not exists duration_minutes int;   -- puste = 120 minut
alter table public.races add column if not exists youtube_url text;
alter table public.races add column if not exists twitch_url text;
alter table public.races add column if not exists tiktok_url text;
-- wydarzenia „Inne” (to samo co supabase/migrations/2026-10-31_inne_wydarzenia.sql)
alter table public.seasons add column if not exists event_format text not null default 'series';
alter table public.seasons add column if not exists roster_mode text not null default 'teams';
alter table public.seasons add column if not exists class_defs jsonb not null default '[]'::jsonb;
alter table public.seasons add column if not exists description text not null default '';
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.seasons'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%(series = %' and pg_get_constraintdef(oid) not like '%inne%'
  loop
    execute format('alter table public.seasons drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seasons'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%(series = %') then
    alter table public.seasons add constraint seasons_series_inne_check check (series in ('f1', 'lmu', 'inne'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seasons'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%(event_format = %') then
    alter table public.seasons add constraint seasons_event_format_check check (event_format in ('series', 'single'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seasons'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%(roster_mode = %') then
    alter table public.seasons add constraint seasons_roster_mode_check check (roster_mode in ('teams', 'cars'));
  end if;
  -- własne klasy aut: stara reguła dopuszczała tylko F1 / GT3 / LMP / HY
  for c in select conrelid::regclass::text as tbl, conname from pg_constraint
    where conrelid in ('public.teams'::regclass, 'public.results'::regclass) and contype = 'c'
      and pg_get_constraintdef(oid) like '%car_class%' and pg_get_constraintdef(oid) like '%''HY''%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.teams'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(car_class)%') then
    alter table public.teams add constraint teams_car_class_len check (char_length(car_class) <= 24);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.results'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(car_class)%') then
    alter table public.results add constraint results_car_class_len check (char_length(car_class) <= 24);
  end if;
end $$;

-- ---------- bezpieczeństwo (Row Level Security) ----------
-- Każdy może czytać dane ligi. Zapis danych ligi: admin i moderator (rangi i konta Discord — tylko admin).
do $$
declare t text;
begin
  foreach t in array array['tracks', 'seasons', 'teams', 'drivers', 'entries', 'roster_changes', 'races', 'results', 'penalties', 'endurance_events', 'endurance_crews', 'endurance_cars', 'lobbies', 'posts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('drop policy if exists "staff write" on public.%I', t);
    execute format('create policy "staff write" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

alter table public.admins enable row level security;
drop policy if exists "read own admin row" on public.admins;
create policy "read own admin row" on public.admins for select to authenticated using (user_id = auth.uid());

-- ---------- startowa baza torów ----------
-- Tor z F1 25 trafia do kategorii F1, tor z Le Mans Ultimate do każdej z klas HY / LMP / GT3 (osobne wpisy).
insert into public.tracks (name, country, country_code, length_km, category)
select v.name, v.country, v.country_code, v.length_km, c.category
from (values
  ('Bahrain International Circuit', 'Bahrajn', 'BH', 5.412, true, true),
  ('Jeddah Corniche Circuit', 'Arabia Saudyjska', 'SA', 6.174, true, false),
  ('Albert Park', 'Australia', 'AU', 5.278, true, false),
  ('Suzuka', 'Japonia', 'JP', 5.807, true, false),
  ('Shanghai International Circuit', 'Chiny', 'CN', 5.451, true, false),
  ('Miami International Autodrome', 'USA', 'US', 5.412, true, false),
  ('Imola', 'Włochy', 'IT', 4.909, true, true),
  ('Monaco', 'Monako', 'MC', 3.337, true, false),
  ('Circuit Gilles Villeneuve', 'Kanada', 'CA', 4.361, true, false),
  ('Circuit de Barcelona-Catalunya', 'Hiszpania', 'ES', 4.657, true, true),
  ('Red Bull Ring', 'Austria', 'AT', 4.318, true, false),
  ('Silverstone', 'Wielka Brytania', 'GB', 5.891, true, true),
  ('Hungaroring', 'Węgry', 'HU', 4.381, true, false),
  ('Spa-Francorchamps', 'Belgia', 'BE', 7.004, true, true),
  ('Zandvoort', 'Holandia', 'NL', 4.259, true, false),
  ('Monza', 'Włochy', 'IT', 5.793, true, true),
  ('Baku City Circuit', 'Azerbejdżan', 'AZ', 6.003, true, false),
  ('Marina Bay', 'Singapur', 'SG', 4.940, true, false),
  ('Circuit of the Americas', 'USA', 'US', 5.513, true, true),
  ('Autódromo Hermanos Rodríguez', 'Meksyk', 'MX', 4.304, true, false),
  ('Interlagos', 'Brazylia', 'BR', 4.309, true, true),
  ('Las Vegas Strip Circuit', 'USA', 'US', 6.201, true, false),
  ('Lusail International Circuit', 'Katar', 'QA', 5.419, true, true),
  ('Yas Marina', 'ZEA', 'AE', 5.281, true, false),
  ('Madring', 'Hiszpania', 'ES', 5.474, true, false),
  ('Circuit de la Sarthe (Le Mans)', 'Francja', 'FR', 13.626, false, true),
  ('Fuji Speedway', 'Japonia', 'JP', 4.563, false, true),
  ('Sebring International Raceway', 'USA', 'US', 6.019, false, true),
  ('Autódromo Internacional do Algarve (Portimão)', 'Portugalia', 'PT', 4.653, false, true),
  ('Circuit Paul Ricard', 'Francja', 'FR', 5.842, false, true)
) as v (name, country, country_code, length_km, in_f1, in_lmu)
cross join (values ('F1'), ('HY'), ('LMP'), ('GT3')) as c (category)
where ((c.category = 'F1' and v.in_f1) or (c.category <> 'F1' and v.in_lmu))
  and not exists (select 1 from public.tracks);

-- ---------- grafiki wgrywane przez panel admina (logo i bolidy zespołów, nitki torów) ----------
-- Pliki trzymane są w Supabase Storage, a w tabelach zapisujemy ich adres.
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

drop policy if exists "images public read" on storage.objects;
create policy "images public read" on storage.objects
  for select using (bucket_id = 'images');
drop policy if exists "images admin write" on storage.objects;
drop policy if exists "images staff write" on storage.objects;
create policy "images staff write" on storage.objects
  for all to authenticated
  using (bucket_id = 'images' and public.is_staff())
  with check (bucket_id = 'images' and public.is_staff());

-- ---------- szybkie pobieranie: cały sezon jednym zapytaniem ----------
-- Strona zamiast ~9 zapytań w trzech falach wywołuje jedną funkcję. Działa z uprawnieniami
-- odwiedzającego (security invoker), więc obowiązują te same reguły RLS co przy zwykłych zapytaniach.
-- p_season = konkretny sezon; gdy pusty — bieżący (albo najnowszy) sezon serii p_series.
create or replace function public.season_bundle(p_season uuid default null, p_series text default null)
returns json
language sql stable
security invoker
set search_path = public
as $$
  with s as (
    select coalesce(p_season, (
      select id from public.seasons where series = p_series
      order by is_current desc, created_at desc limit 1
    )) as id
  )
  select json_build_object(
    'seasons',        coalesce((select json_agg(x) from public.seasons x, s where x.id = s.id), '[]'::json),
    'teams',          coalesce((select json_agg(x order by x.name) from public.teams x, s where x.season_id = s.id), '[]'::json),
    'entries',        coalesce((select json_agg(x) from public.entries x, s where x.season_id = s.id), '[]'::json),
    'races',          coalesce((select json_agg(x order by x.round) from public.races x, s where x.season_id = s.id), '[]'::json),
    'tracks',         coalesce((select json_agg(x order by x.name) from public.tracks x), '[]'::json),
    'drivers',        coalesce((select json_agg(x order by x.nick) from public.drivers x), '[]'::json),
    'results',        coalesce((select json_agg(x) from public.results x join public.races r on r.id = x.race_id, s where r.season_id = s.id), '[]'::json),
    'penalties',      coalesce((select json_agg(x order by x.created_at) from public.penalties x join public.races r on r.id = x.race_id, s where r.season_id = s.id), '[]'::json),
    'roster_changes', coalesce((select json_agg(x order by x.from_round) from public.roster_changes x, s where x.season_id = s.id), '[]'::json)
  );
$$;
grant execute on function public.season_bundle(uuid, text) to anon, authenticated;

-- ---------- logowanie przez Discord (opis zasad: supabase/migrations/2026-10-30_discord.sql) ----------
alter table public.drivers add column if not exists avatar_url text;  -- awatar z Discorda (publiczny)

create table if not exists public.discord_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  discord_id text not null unique,
  username text,                         -- nazwa konta Discord
  display_name text,                     -- nazwa wyświetlana na Discordzie — z niej bierzemy nick
  avatar_url text,
  driver_id uuid unique references public.drivers (id) on delete set null,       -- powiązany kierowca
  claim_driver_id uuid references public.drivers (id) on delete set null,        -- prośba o powiązanie (czeka na admina)
  auto_driver boolean not null default false,  -- driver_id utworzony automatycznie przy pierwszym logowaniu
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

alter table public.discord_accounts enable row level security;
drop policy if exists "own or admin read" on public.discord_accounts;
create policy "own or admin read" on public.discord_accounts for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admin write" on public.discord_accounts;
create policy "admin write" on public.discord_accounts for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- stan konta zalogowanego użytkownika (dla strony)
create or replace function public.discord_state(p_user uuid)
returns json
language sql stable
security definer
set search_path = public
as $$
  select json_build_object(
    'status', case when a.driver_id is not null then 'linked' when a.claim_driver_id is not null then 'pending' else 'unlinked' end,
    'display_name', a.display_name, 'username', a.username, 'avatar_url', a.avatar_url,
    'driver_id', a.driver_id, 'driver_nick', d.nick, 'auto_driver', a.auto_driver,
    'claim_driver_id', a.claim_driver_id, 'claim_nick', c.nick)
  from public.discord_accounts a
  left join public.drivers d on d.id = a.driver_id
  left join public.drivers c on c.id = a.claim_driver_id
  where a.user_id = p_user;
$$;
revoke all on function public.discord_state(uuid) from public, anon, authenticated;

-- wywoływane przez stronę po każdym zalogowaniu przez Discord
create or replace function public.discord_login()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  u auth.users%rowtype;
  meta jsonb;
  v_discord text;
  v_user text;
  v_name text;
  v_avatar text;
  acc public.discord_accounts%rowtype;
  v_driver uuid;
begin
  select * into u from auth.users where id = auth.uid();
  if not found then raise exception 'Nie jesteś zalogowany'; end if;
  if not (coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'discord' or u.raw_app_meta_data ->> 'provider' = 'discord') then
    return json_build_object('status', 'not_discord');
  end if;

  -- dane z Discorda zapisane przez Supabase przy logowaniu (nie z przeglądarki — nie da się ich podrobić)
  meta := u.raw_user_meta_data;
  v_discord := coalesce(meta ->> 'provider_id', meta ->> 'sub');
  v_user := meta ->> 'full_name';
  v_name := left(btrim(coalesce(nullif(meta -> 'custom_claims' ->> 'global_name', ''), v_user, 'Kierowca')), 40);
  v_avatar := coalesce(meta ->> 'avatar_url', meta ->> 'picture');

  select * into acc from public.discord_accounts where user_id = u.id;
  if not found then
    insert into public.discord_accounts (user_id, discord_id, username, display_name, avatar_url, last_login_at)
    values (u.id, v_discord, v_user, v_name, v_avatar, now());

    -- kierowca z takim samym nickiem, jeszcze bez konta → prośba o powiązanie (zatwierdza admin)
    select d.id into v_driver from public.drivers d
    where lower(d.nick) = lower(v_name)
      and not exists (select 1 from public.discord_accounts a where a.driver_id = d.id)
    limit 1;
    if v_driver is not null then
      update public.discord_accounts set claim_driver_id = v_driver where user_id = u.id;
    elsif not exists (select 1 from public.drivers where lower(nick) = lower(v_name)) then
      -- nowy kierowca z nickiem z Discorda
      insert into public.drivers (nick, avatar_url) values (v_name, v_avatar) returning id into v_driver;
      update public.discord_accounts set driver_id = v_driver, auto_driver = true where user_id = u.id;
    end if;
    -- (nick zajęty przez kierowcę z innym kontem → konto czeka, aż admin je powiąże)
  else
    update public.discord_accounts
      set username = v_user, display_name = v_name, avatar_url = v_avatar, last_login_at = now()
      where user_id = u.id;
    -- nick i awatar kierowcy zawsze jak na Discordzie (o ile nikt inny nie ma już takiego nicku)
    if acc.driver_id is not null then
      update public.drivers set avatar_url = v_avatar where id = acc.driver_id;
      if not exists (select 1 from public.drivers where lower(nick) = lower(v_name) and id <> acc.driver_id) then
        update public.drivers set nick = v_name where id = acc.driver_id and nick is distinct from v_name;
      end if;
    end if;
  end if;

  return public.discord_state(u.id);
end;
$$;
grant execute on function public.discord_login() to authenticated;

-- użytkownik: „startowałem już pod innym nickiem” → prośba o powiązanie z istniejącym kierowcą (null = anuluj)
create or replace function public.discord_request_link(p_driver uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.discord_accounts where user_id = auth.uid()) then
    raise exception 'Najpierw zaloguj się przez Discord';
  end if;
  if p_driver is not null then
    if not exists (select 1 from public.drivers where id = p_driver) then raise exception 'Nie ma takiego kierowcy'; end if;
    if exists (select 1 from public.discord_accounts where driver_id = p_driver) then
      raise exception 'Ten kierowca jest już powiązany z kontem Discord — napisz do admina';
    end if;
  end if;
  update public.discord_accounts set claim_driver_id = p_driver where user_id = auth.uid();
  return public.discord_state(auth.uid());
end;
$$;
grant execute on function public.discord_request_link(uuid) to authenticated;

-- scalenie dwóch profili kierowcy: wszystko z p_from przechodzi na p_to, p_from znika
create or replace function public.merge_drivers(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień'; end if;
  if p_from = p_to then return; end if;
  if exists (select 1 from public.results a join public.results b on a.race_id = b.race_id where a.driver_id = p_from and b.driver_id = p_to) then
    raise exception 'Nie można scalić: oba profile mają wynik w tym samym wyścigu';
  end if;
  if exists (select 1 from public.entries a join public.entries b on a.season_id = b.season_id where a.driver_id = p_from and b.driver_id = p_to) then
    raise exception 'Nie można scalić: oba profile są w składzie tego samego sezonu — usuń jeden z nich ze składu';
  end if;
  update public.results set driver_id = p_to where driver_id = p_from;
  update public.penalties set driver_id = p_to where driver_id = p_from;
  update public.entries set driver_id = p_to where driver_id = p_from;
  update public.roster_changes set driver_in_id = p_to where driver_in_id = p_from;
  update public.roster_changes set driver_out_id = p_to where driver_out_id = p_from;
  update public.endurance_crews set driver_ids = array_replace(driver_ids, p_from, p_to) where p_from = any (driver_ids);
  delete from public.drivers where id = p_from;
end;
$$;
grant execute on function public.merge_drivers(uuid, uuid) to authenticated;

-- admin: powiąż konto Discord z kierowcą (p_driver = null → odłącz)
create or replace function public.discord_link(p_user uuid, p_driver uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  acc public.discord_accounts%rowtype;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień'; end if;
  select * into acc from public.discord_accounts where user_id = p_user for update;
  if not found then raise exception 'Nie ma takiego konta Discord'; end if;

  if p_driver is null then
    update public.discord_accounts set driver_id = null, auto_driver = false, claim_driver_id = null where user_id = p_user;
    return public.discord_state(p_user);
  end if;
  if exists (select 1 from public.discord_accounts where driver_id = p_driver and user_id <> p_user) then
    raise exception 'Ten kierowca jest już powiązany z innym kontem Discord';
  end if;

  update public.discord_accounts set driver_id = null where user_id = p_user;
  -- profil założony automatycznie przy pierwszym logowaniu łączymy z wybranym kierowcą
  if acc.driver_id is not null and acc.driver_id <> p_driver and acc.auto_driver then
    perform public.merge_drivers(acc.driver_id, p_driver);
  end if;
  update public.discord_accounts set driver_id = p_driver, auto_driver = false, claim_driver_id = null where user_id = p_user;

  -- nick i awatar jak na Discordzie
  update public.drivers set avatar_url = acc.avatar_url where id = p_driver;
  if acc.display_name is not null and not exists (select 1 from public.drivers where lower(nick) = lower(acc.display_name) and id <> p_driver) then
    update public.drivers set nick = acc.display_name where id = p_driver;
  end if;
  return public.discord_state(p_user);
end;
$$;
grant execute on function public.discord_link(uuid, uuid) to authenticated;

-- admin: odrzuć prośbę o powiązanie
create or replace function public.discord_reject_claim(p_user uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień'; end if;
  update public.discord_accounts set claim_driver_id = null where user_id = p_user;
  return public.discord_state(p_user);
end;
$$;
grant execute on function public.discord_reject_claim(uuid) to authenticated;

-- admin: lista użytkowników z rangami
create or replace function public.list_users()
returns table (user_id uuid, login text, provider text, display_name text, avatar_url text, driver_id uuid,
               role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Tylko administrator może zarządzać rangami'; end if;
  return query
    select u.id,
           -- login tylko dla kont z loginem i hasłem; e-maili z Discorda nie pokazujemy (RODO)
           case when u.email like '%@ssp.example.com' then split_part(u.email, '@', 1) else null end,
           coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
           coalesce(d.display_name, u.raw_user_meta_data -> 'custom_claims' ->> 'global_name', u.raw_user_meta_data ->> 'full_name'),
           coalesce(d.avatar_url, u.raw_user_meta_data ->> 'avatar_url'),
           d.driver_id,
           case when lower(u.email) = 'admin@ssp.example.com' then 'owner' else coalesce(r.role, 'user') end,
           u.created_at,
           u.last_sign_in_at
    from auth.users u
    left join public.user_roles r on r.user_id = u.id
    left join public.discord_accounts d on d.user_id = u.id
    order by u.created_at;
end;
$$;
grant execute on function public.list_users() to authenticated;

-- admin: zmiana rangi użytkownika (bez konta głównego i bez własnej rangi)
create or replace function public.set_user_role(p_user uuid, p_role text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Tylko administrator może zmieniać rangi'; end if;
  if p_user = auth.uid() then raise exception 'Nie możesz zmienić własnej rangi'; end if;
  if p_role not in ('admin', 'moderator', 'user') then raise exception 'Nieznana ranga: %', p_role; end if;
  if exists (select 1 from auth.users where id = p_user and lower(email) = 'admin@ssp.example.com') then
    raise exception 'Rangi konta głównego nie można zmienić';
  end if;
  insert into public.user_roles (user_id, role, updated_at) values (p_user, p_role, now())
    on conflict (user_id) do update set role = excluded.role, updated_at = now();
end;
$$;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- ---------- kierowca dnia: głosowanie w trakcie wyścigu (opis: supabase/migrations/2026-11-01_kierowca_dnia.sql) ----------
create table if not exists public.dotd_votes (
  race_id uuid not null references public.races (id) on delete cascade,
  voter text not null,                   -- 'u:<id konta>' albo 'b:<losowy identyfikator przeglądarki>'
  user_id uuid references auth.users (id) on delete set null,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  ip_hash text,                          -- md5(wyścig + adres) — limit głosów z jednej sieci
  created_at timestamptz not null default now(),
  primary key (race_id, voter)
);
-- baza z pierwszą wersją tabeli (jeden głos na konto: klucz race_id + user_id) → nowe kolumny i klucz
alter table public.dotd_votes add column if not exists voter text;
alter table public.dotd_votes add column if not exists ip_hash text;
update public.dotd_votes set voter = 'u:' || user_id where voter is null;
alter table public.dotd_votes alter column voter set not null;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'dotd_votes_pkey' and pg_get_constraintdef(oid) not like '%voter%') then
    alter table public.dotd_votes drop constraint dotd_votes_pkey;
    alter table public.dotd_votes add primary key (race_id, voter);
  end if;
end $$;
alter table public.dotd_votes alter column user_id drop not null;
create index if not exists dotd_votes_ip_idx on public.dotd_votes (race_id, ip_hash);

alter table public.dotd_votes enable row level security;
drop policy if exists "read own vote" on public.dotd_votes;
-- (brak polityk = strona nie czyta tabeli bezpośrednio; głos i wyniki wyłącznie przez funkcje poniżej)

-- głosowanie otwarte: wyścig niezatwierdzony, od startu przez czas trwania (domyślnie 120 min)
create or replace function public.dotd_window_open(p_race uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.races r
    where r.id = p_race and r.status <> 'completed' and r.race_date is not null
      and now() >= r.race_date and now() < r.race_date + make_interval(mins => coalesce(r.duration_minutes, 120))
  );
$$;
grant execute on function public.dotd_window_open(uuid) to anon, authenticated;

-- kto głosuje: konto (zalogowany) albo identyfikator przeglądarki (gość)
create or replace function public.dotd_voter(p_token text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then return 'u:' || auth.uid(); end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9-]{16,64}$' then raise exception 'Nieprawidłowy identyfikator głosującego'; end if;
  return 'b:' || p_token;
end;
$$;

-- pierwsza wersja funkcji (tylko zalogowani) — zastąpiona przez dotd_vote(wyścig, kierowca, identyfikator)
drop function if exists public.dotd_vote(uuid, uuid);

-- oddanie głosu (jeden na wyścig, bez zmiany)
create or replace function public.dotd_vote(p_race uuid, p_driver uuid, p_token text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_voter text := public.dotd_voter(p_token);
  v_ip text := btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  v_hash text := case when v_ip <> '' then md5(p_race::text || v_ip) end;
begin
  perform public.dotd_clear_ip();
  if not public.dotd_window_open(p_race) then
    raise exception 'Głosowanie na kierowcę dnia jest zamknięte — trwa tylko podczas wyścigu';
  end if;
  if not exists (select 1 from public.entries e join public.races r on r.season_id = e.season_id where r.id = p_race and e.driver_id = p_driver) then
    raise exception 'Ten kierowca nie jedzie w tym wyścigu';
  end if;
  if exists (select 1 from public.dotd_votes where race_id = p_race and voter = v_voter) then
    raise exception 'Już głosowałeś w tym wyścigu';
  end if;
  if v_hash is not null and (select count(*) from public.dotd_votes where race_id = p_race and ip_hash = v_hash) >= 5 then
    raise exception 'Z tej sieci oddano już limit głosów w tym wyścigu';
  end if;
  insert into public.dotd_votes (race_id, voter, user_id, driver_id, ip_hash)
  values (p_race, v_voter, auth.uid(), p_driver, v_hash)
  on conflict (race_id, voter) do nothing;
end;
$$;
grant execute on function public.dotd_vote(uuid, uuid, text) to anon, authenticated;

-- stan głosowania dla okna: czy otwarte, czy już głosowałem (i na kogo) oraz wyniki — tylko po oddaniu głosu albo po zamknięciu
create or replace function public.dotd_poll(p_race uuid, p_token text)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_open boolean := public.dotd_window_open(p_race);
  v_my uuid;
begin
  select driver_id into v_my from public.dotd_votes where race_id = p_race and voter = public.dotd_voter(p_token);
  return json_build_object(
    'open', v_open,
    'my', v_my,
    'results', case when v_my is not null or not v_open then coalesce((
      select json_agg(json_build_object('driver_id', driver_id, 'votes', votes) order by votes desc)
      from (select driver_id, count(*)::int votes from public.dotd_votes where race_id = p_race group by driver_id) x
    ), '[]'::json) end);
end;
$$;
grant execute on function public.dotd_poll(uuid, text) to anon, authenticated;

-- wyniki sezonu (publiczne, kalendarz): liczba głosów na kierowcę w każdym wyścigu, dopiero po zamknięciu głosowania
create or replace function public.dotd_results(p_season uuid)
returns table (race_id uuid, driver_id uuid, votes int, total int)
language sql stable security definer
set search_path = public
as $$
  select v.race_id, v.driver_id, count(*)::int, (sum(count(*)) over (partition by v.race_id))::int
  from public.dotd_votes v
  join public.races r on r.id = v.race_id
  where r.season_id = p_season and not public.dotd_window_open(r.id)
  group by v.race_id, v.driver_id;
$$;
grant execute on function public.dotd_results(uuid) to anon, authenticated;

-- ---------- prywatność: skrót IP tylko na czas głosowania, „Odepnij konto Discord” (opis: migrations/2026-11-02_prywatnosc.sql) ----------
-- kasuje skróty IP wyścigów, w których głosowanie już się zakończyło
create or replace function public.dotd_clear_ip()
returns void
language sql security definer
set search_path = public
as $$
  update public.dotd_votes v set ip_hash = null
  where v.ip_hash is not null and not public.dotd_window_open(v.race_id);
$$;
revoke all on function public.dotd_clear_ip() from public, anon, authenticated;

-- po zatwierdzeniu wyścigu głosowanie jest zamknięte — skróty IP od razu znikają
create or replace function public.dotd_clear_ip_on_race()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status = 'completed' then
    update public.dotd_votes set ip_hash = null where race_id = new.id and ip_hash is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists dotd_clear_ip_on_race on public.races;
create trigger dotd_clear_ip_on_race after update of status on public.races
  for each row execute function public.dotd_clear_ip_on_race();

do $$ begin perform public.dotd_clear_ip(); end $$;

-- ---------- 3. „Odepnij konto Discord” — użytkownik usuwa swoje konto ----------
-- Usuwa konto logowania i dane z Discorda (ID, nazwy, e-mail, awatar), rangę i zgłoszenia z formularzy.
-- Profil kierowcy (nick, wyniki, składy) zostaje jako część historii ligi; znika z niego awatar z Discorda.
-- Oddane głosy na kierowcę dnia zostają w wynikach, ale bez powiązania z kontem.
-- Ponowne logowanie przez Discord zakłada nowe konto (powiązanie z profilem kierowcy zatwierdza admin).
create or replace function public.discord_unlink_me()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_anon text := 'x:' || gen_random_uuid();  -- jeden anonimowy identyfikator na wszystkie głosy tej osoby
  acc public.discord_accounts%rowtype;
begin
  if v_uid is null then raise exception 'Nie jesteś zalogowany'; end if;
  select * into acc from public.discord_accounts where user_id = v_uid;
  if not found then raise exception 'To nie jest konto Discord'; end if;
  if acc.driver_id is not null then
    update public.drivers set avatar_url = null where id = acc.driver_id;
  end if;
  update public.dotd_votes set voter = 'x:' || gen_random_uuid(), user_id = null where voter = 'u:' || v_uid;
  update public.poll_votes set voter = v_anon where voter = 'u:' || v_uid;
  delete from auth.users where id = v_uid;  -- razem z nim: discord_accounts, ranga, zgłoszenia
end;
$$;
grant execute on function public.discord_unlink_me() to authenticated;

-- ---------- formularz zgłoszeń w ogłoszeniach (opis: supabase/migrations/2026-11-01_zgloszenia.sql) ----------
alter table public.posts add column if not exists form_kind text;                -- null | 'internal' | 'external'
alter table public.posts add column if not exists form_url text;                 -- zewnętrzny formularz
alter table public.posts add column if not exists form_fields jsonb not null default '[]'::jsonb;  -- [{id, label, type, required, options}]
alter table public.posts add column if not exists form_season_id uuid references public.seasons (id) on delete set null;
alter table public.posts add column if not exists form_until timestamptz;        -- koniec zgłoszeń (i widoczności na stronie głównej)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_form_kind_check') then
    alter table public.posts add constraint posts_form_kind_check check (form_kind in ('internal', 'external'));
  end if;
end $$;

create table if not exists public.signups (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text,                     -- nazwa z Discorda w chwili zgłoszenia
  avatar_url text,
  answers jsonb not null default '{}'::jsonb,   -- {id pola: odpowiedź}
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  driver_id uuid references public.drivers (id) on delete set null,   -- kierowca dodany do rezerwy po przyjęciu
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, user_id)
);
create index if not exists signups_post_idx on public.signups (post_id);

-- lista zgłoszeń: tylko moderator i wyżej; użytkownik widzi własne. Zapis wyłącznie przez funkcje poniżej.
alter table public.signups enable row level security;
drop policy if exists "own or staff read" on public.signups;
create policy "own or staff read" on public.signups for select to authenticated using (user_id = auth.uid() or public.is_staff());
drop policy if exists "staff delete" on public.signups;
create policy "staff delete" on public.signups for delete to authenticated using (public.is_staff());

-- czy formularz przyjmuje zgłoszenia
create or replace function public.signup_open(p_post uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.posts p where p.id = p_post and p.form_kind = 'internal' and (p.form_until is null or now() < p.form_until));
$$;
grant execute on function public.signup_open(uuid) to anon, authenticated;

-- zgłoszenia usuwane automatycznie 30 dni po zakończeniu zapisów (polityka prywatności) — sprzątanie przy okazji
-- odczytu zgłoszeń (moje zgłoszenia, panel), bez harmonogramu zadań
create or replace function public.signups_cleanup()
returns void
language sql security definer
set search_path = public
as $$
  delete from public.signups s using public.posts p
  where p.id = s.post_id and p.form_until is not null and p.form_until < now() - interval '30 days';
$$;
revoke all on function public.signups_cleanup() from public, anon, authenticated;

-- moje zgłoszenia (status widzi tylko zgłaszający)
create or replace function public.my_signups()
returns json
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.signups_cleanup();
  return (select coalesce(json_agg(json_build_object('post_id', s.post_id, 'status', s.status, 'answers', s.answers, 'updated_at', s.updated_at)), '[]'::json)
          from public.signups s where s.user_id = auth.uid());
end;
$$;
grant execute on function public.my_signups() to authenticated;

-- wysłanie / poprawienie zgłoszenia (do końca zapisów, dopóki nie zostało rozpatrzone)
create or replace function public.signup_submit(p_post uuid, p_answers jsonb)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  acc public.discord_accounts%rowtype;
  p public.posts%rowtype;
  f jsonb;
  v text;
  clean jsonb := '{}'::jsonb;
  cur public.signups%rowtype;
begin
  select * into acc from public.discord_accounts where user_id = auth.uid();
  if not found then raise exception 'Zgłoszenia przyjmujemy tylko od osób zalogowanych przez Discord'; end if;
  select * into p from public.posts where id = p_post;
  if not found or p.form_kind is distinct from 'internal' then raise exception 'To ogłoszenie nie ma formularza zgłoszeń'; end if;
  if not public.signup_open(p_post) then raise exception 'Zgłoszenia są już zamknięte'; end if;

  -- tylko pola z formularza; wymagane muszą być wypełnione
  for f in select * from jsonb_array_elements(coalesce(p.form_fields, '[]'::jsonb)) loop
    v := left(btrim(coalesce(p_answers ->> (f ->> 'id'), '')), 2000);
    if (f ->> 'type') = 'checkbox' then v := case when v = 'true' then 'true' else '' end; end if;
    if coalesce((f ->> 'required')::boolean, false) and v = '' then
      raise exception 'Uzupełnij pole: %', f ->> 'label';
    end if;
    if v <> '' then clean := clean || jsonb_build_object(f ->> 'id', v); end if;
  end loop;

  select * into cur from public.signups where post_id = p_post and user_id = auth.uid();
  if found and cur.status <> 'pending' then raise exception 'Twoje zgłoszenie zostało już rozpatrzone'; end if;
  insert into public.signups (post_id, user_id, display_name, avatar_url, answers)
  values (p_post, auth.uid(), acc.display_name, acc.avatar_url, clean)
  on conflict (post_id, user_id) do update
    set answers = excluded.answers, display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = now();
  return public.my_signups();
end;
$$;
grant execute on function public.signup_submit(uuid, jsonb) to authenticated;

-- wycofanie własnego zgłoszenia (do końca zapisów, dopóki nie zostało rozpatrzone)
create or replace function public.signup_withdraw(p_post uuid)
returns json
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.signup_open(p_post) then raise exception 'Zgłoszenia są już zamknięte'; end if;
  delete from public.signups where post_id = p_post and user_id = auth.uid() and status = 'pending';
  return public.my_signups();
end;
$$;
grant execute on function public.signup_withdraw(uuid) to authenticated;

-- panel: zgłoszenia z aktualnym kierowcą konta i informacją, czy jest już w składzie sezonu
create or replace function public.signup_list(p_post uuid)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_season uuid;
begin
  if not public.is_staff() then raise exception 'Brak uprawnień'; end if;
  perform public.signups_cleanup();
  select form_season_id into v_season from public.posts where id = p_post;
  return coalesce((
    select json_agg(json_build_object(
      'id', s.id, 'user_id', s.user_id, 'display_name', s.display_name, 'avatar_url', s.avatar_url,
      'answers', s.answers, 'status', s.status, 'decided_by', s.decided_by, 'decided_at', s.decided_at,
      'created_at', s.created_at, 'updated_at', s.updated_at,
      'driver_id', coalesce(s.driver_id, a.driver_id), 'driver_nick', d.nick, 'claim_nick', c.nick,
      'in_season', e.id is not null, 'team_id', e.team_id
    ) order by s.created_at)
    from public.signups s
    left join public.discord_accounts a on a.user_id = s.user_id
    left join public.drivers d on d.id = coalesce(s.driver_id, a.driver_id)
    left join public.drivers c on c.id = a.claim_driver_id
    left join public.entries e on e.season_id = v_season and e.driver_id = coalesce(s.driver_id, a.driver_id)
    where s.post_id = p_post
  ), '[]'::json);
end;
$$;
grant execute on function public.signup_list(uuid) to authenticated;

-- decyzja: 'accepted' = kierowca trafia do rezerwy sezonu z formularza; 'rejected' / 'pending' = odrzucenie / cofnięcie decyzji
create or replace function public.signup_decide(p_signup uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  s public.signups%rowtype;
  v_season uuid;
  acc public.discord_accounts%rowtype;
  v_driver uuid;
  v_me text;
begin
  if not public.is_staff() then raise exception 'Brak uprawnień'; end if;
  if p_status not in ('pending', 'accepted', 'rejected') then raise exception 'Nieprawidłowy status'; end if;
  select * into s from public.signups where id = p_signup for update;
  if not found then raise exception 'Nie ma takiego zgłoszenia'; end if;
  select form_season_id into v_season from public.posts where id = s.post_id;
  select coalesce((select display_name from public.discord_accounts where user_id = auth.uid()),
                  split_part((select email from auth.users where id = auth.uid()), '@', 1)) into v_me;

  if p_status = 'accepted' then
    if v_season is null then raise exception 'Formularz nie ma wybranego sezonu — ustaw go w edycji ogłoszenia'; end if;
    select * into acc from public.discord_accounts where user_id = s.user_id for update;
    if not found then raise exception 'Konto Discord tej osoby już nie istnieje'; end if;
    v_driver := acc.driver_id;
    if v_driver is null then
      if acc.claim_driver_id is not null then
        raise exception 'Konto czeka na powiązanie z istniejącym kierowcą — najpierw rozpatrz prośbę w panelu Użytkownicy';
      end if;
      if exists (select 1 from public.drivers where lower(nick) = lower(acc.display_name)) then
        raise exception 'Nick „%” ma już inny kierowca — powiąż konto z kierowcą w panelu Użytkownicy', acc.display_name;
      end if;
      -- nowy profil kierowcy z nickiem z Discorda, powiązany z kontem
      insert into public.drivers (nick, avatar_url) values (acc.display_name, acc.avatar_url) returning id into v_driver;
      update public.discord_accounts set driver_id = v_driver, auto_driver = true where user_id = s.user_id;
    end if;
    insert into public.entries (season_id, driver_id, team_id, is_reserve) values (v_season, v_driver, null, true)
    on conflict (season_id, driver_id) do nothing;
    update public.signups set status = 'accepted', driver_id = v_driver, decided_by = v_me, decided_at = now() where id = p_signup;
  else
    -- cofnięcie przyjęcia: zdejmujemy z rezerwy, jeśli kierowca nie dostał jeszcze miejsca w zespole i nie ma wyników
    if s.status = 'accepted' and s.driver_id is not null and v_season is not null then
      delete from public.entries e
      where e.season_id = v_season and e.driver_id = s.driver_id and e.team_id is null
        and not exists (select 1 from public.results r join public.races x on x.id = r.race_id where x.season_id = v_season and r.driver_id = s.driver_id)
        and not exists (select 1 from public.roster_changes c where c.season_id = v_season and (c.driver_in_id = s.driver_id or c.driver_out_id = s.driver_id));
    end if;
    update public.signups set status = p_status,
      decided_by = case when p_status = 'pending' then null else v_me end,
      decided_at = case when p_status = 'pending' then null else now() end
    where id = p_signup;
  end if;
end;
$$;
grant execute on function public.signup_decide(uuid, text) to authenticated;

-- ---------- głosowanie (ankieta) w ogłoszeniu (opis: supabase/migrations/2026-11-02_glosowania.sql) ----------
alter table public.posts add column if not exists poll_multi boolean not null default false;  -- wiele odpowiedzi
alter table public.posts add column if not exists poll_results jsonb;  -- łączne wyniki po usunięciu pojedynczych głosów
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'posts_form_kind_check' and pg_get_constraintdef(oid) not like '%poll%') then
    alter table public.posts drop constraint posts_form_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_form_kind_check') then
    alter table public.posts add constraint posts_form_kind_check check (form_kind in ('internal', 'external', 'poll'));
  end if;
end $$;

create table if not exists public.poll_votes (
  post_id uuid not null references public.posts (id) on delete cascade,
  voter text not null,                   -- 'u:<id konta>'; po odpięciu konta Discord — anonimowy 'x:<losowy>'
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, voter, option_id)
);
-- brak polityk = strona nie czyta tabeli bezpośrednio; głos i wyniki wyłącznie przez funkcje poniżej
alter table public.poll_votes enable row level security;

-- czy głosowanie trwa
create or replace function public.poll_open(p_post uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.posts p where p.id = p_post and p.form_kind = 'poll' and (p.form_until is null or now() < p.form_until));
$$;
grant execute on function public.poll_open(uuid) to anon, authenticated;

-- łączne wyniki: {"votes": {id odpowiedzi: liczba}, "voters": liczba głosujących}
create or replace function public.poll_tally(p_post uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'votes', coalesce((select jsonb_object_agg(option_id, n) from (select option_id, count(*) n from public.poll_votes where post_id = p_post group by option_id) x), '{}'::jsonb),
    'voters', (select count(distinct voter) from public.poll_votes where post_id = p_post));
$$;
revoke all on function public.poll_tally(uuid) from public, anon, authenticated;

-- 30 dni po zakończeniu: zapisujemy łączne wyniki w ogłoszeniu i usuwamy pojedyncze głosy
create or replace function public.poll_cleanup()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select p.id from public.posts p
           where p.form_kind = 'poll' and p.form_until is not null and p.form_until < now() - interval '30 days'
             and exists (select 1 from public.poll_votes v where v.post_id = p.id) loop
    update public.posts set poll_results = public.poll_tally(r.id) where id = r.id;
    delete from public.poll_votes where post_id = r.id;
  end loop;
end;
$$;
revoke all on function public.poll_cleanup() from public, anon, authenticated;

-- stan głosowania: czy trwa, mój głos, wyniki (po oddaniu głosu, po zakończeniu albo dla moderatora)
create or replace function public.poll_state(p_post uuid)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  p public.posts%rowtype;
  v_open boolean;
  v_my text[];
begin
  perform public.poll_cleanup();
  select * into p from public.posts where id = p_post and form_kind = 'poll';
  if not found then raise exception 'To ogłoszenie nie ma głosowania'; end if;
  v_open := public.poll_open(p_post);
  if auth.uid() is not null then
    select array_agg(option_id) into v_my from public.poll_votes where post_id = p_post and voter = 'u:' || auth.uid();
  end if;
  return json_build_object(
    'open', v_open,
    'my', coalesce(v_my, '{}'),
    'results', case when not v_open or v_my is not null or public.is_staff() then coalesce(p.poll_results, public.poll_tally(p_post)) end);
end;
$$;
grant execute on function public.poll_state(uuid) to anon, authenticated;

-- oddanie / zmiana głosu (do końca głosowania)
create or replace function public.poll_vote(p_post uuid, p_options text[])
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  p public.posts%rowtype;
  v_voter text := 'u:' || auth.uid();
  v_opts text[];
begin
  if not exists (select 1 from public.discord_accounts where user_id = auth.uid()) then
    raise exception 'Głosować mogą osoby zalogowane przez Discord';
  end if;
  select * into p from public.posts where id = p_post and form_kind = 'poll';
  if not found then raise exception 'To ogłoszenie nie ma głosowania'; end if;
  if not public.poll_open(p_post) then raise exception 'Głosowanie jest już zakończone'; end if;
  v_opts := array(select distinct x from unnest(coalesce(p_options, '{}')) x);
  if cardinality(v_opts) = 0 then raise exception 'Wybierz odpowiedź'; end if;
  if not p.poll_multi and cardinality(v_opts) > 1 then raise exception 'W tym głosowaniu można wybrać tylko jedną odpowiedź'; end if;
  if exists (select 1 from unnest(v_opts) o
             where not exists (select 1 from jsonb_array_elements(coalesce(p.form_fields, '[]'::jsonb)) f where f ->> 'id' = o)) then
    raise exception 'Nieprawidłowa odpowiedź';
  end if;
  delete from public.poll_votes where post_id = p_post and voter = v_voter;
  insert into public.poll_votes (post_id, voter, option_id) select p_post, v_voter, o from unnest(v_opts) o;
  return public.poll_state(p_post);
end;
$$;
grant execute on function public.poll_vote(uuid, text[]) to authenticated;

-- =====================================================================
-- PO URUCHOMIENIU: załóż konto główne
--  Authentication → Users → Add user → e-mail admin@ssp.example.com + hasło, zaznacz "Auto Confirm User".
--  Na stronie logujesz się loginem „admin” — to konto główne (zawsze admin): pełny dostęp i nadawanie rang
--  innym (Panel → Użytkownicy: admin / moderator / użytkownik).
-- =====================================================================
