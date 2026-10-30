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

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

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
  series text not null default 'f1' check (series in ('f1', 'lmu')),
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
  car_class text check (car_class in ('F1', 'GT3', 'LMP', 'HY')),  -- LMU: klasa zespołu (podpowiedź w wynikach)
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
  notes text default '',
  created_at timestamptz not null default now()
);

-- ---------- wyniki (surowe, przed karami) ----------
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete restrict,
  team_id uuid references public.teams (id) on delete set null,
  car_class text check (car_class in ('F1', 'GT3', 'LMP', 'HY')),  -- klasa samochodu w tym wyścigu
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
-- dodanie kolumny do bazy utworzonej wcześniejszą wersją tego pliku (bezpieczne)
alter table public.endurance_crews add column if not exists hall_of_fame boolean not null default false;
alter table public.races add column if not exists weather text;
alter table public.races add column if not exists game_time text;
alter table public.endurance_crews add column if not exists car_id uuid references public.endurance_cars (id) on delete set null;
alter table public.seasons add column if not exists team_points text not null default 'final' check (team_points in ('lineup', 'final', 'result'));

-- ---------- bezpieczeństwo (Row Level Security) ----------
-- Każdy może czytać dane ligi; zapisywać mogą tylko użytkownicy z tabeli admins.
do $$
declare t text;
begin
  foreach t in array array['tracks', 'seasons', 'teams', 'drivers', 'entries', 'roster_changes', 'races', 'results', 'penalties', 'endurance_events', 'endurance_crews', 'endurance_cars'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
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
create policy "images admin write" on storage.objects
  for all to authenticated
  using (bucket_id = 'images' and public.is_admin())
  with check (bucket_id = 'images' and public.is_admin());

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

-- =====================================================================
-- PO URUCHOMIENIU: nadaj sobie uprawnienia admina
--  1. Authentication → Users → Add user → (e-mail + hasło, zaznacz "Auto Confirm User")
--  2. Skopiuj "User UID" tego użytkownika i wykonaj:
--       insert into public.admins (user_id) values ('WKLEJ-TUTAJ-UID');
-- =====================================================================
