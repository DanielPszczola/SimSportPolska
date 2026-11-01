-- Aktualizacja bazy: głosowanie na kierowcę dnia (wyścigi lig F1 / LMU i wydarzeń „Inne”).
-- Głosować może każdy — jeden głos na wyścig: zalogowany = konto, gość = identyfikator przeglądarki (localStorage).
-- Dodatkowo najwyżej 5 głosów z jednego adresu sieciowego na wyścig (zapisywany jest tylko skrót adresu, nie sam adres).
-- Głosowanie trwa w trakcie wyścigu (od startu przez czas trwania). Kto zagłosował, widzi bieżące wyniki;
-- wszyscy widzą wynik po zamknięciu głosowania (kalendarz).
-- Niczego nie usuwa z danych. Można uruchomić wielokrotnie, także na bazie z pierwszą wersją tej aktualizacji
-- (Supabase → SQL Editor → wklej → Run).

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

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
