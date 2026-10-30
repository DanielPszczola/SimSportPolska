-- Aktualizacja bazy: elementy z wcześniejszych wersji strony, których brakuje w bazie.
-- Tylko DODAJE kolumny i funkcję — niczego nie usuwa ani nie zmienia w istniejących danych.
-- Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).

-- zasada liczenia punktów konstruktorów w sezonie (domyślnie wg regulaminu: suma punktów końcowego składu)
alter table public.seasons add column if not exists team_points text not null default 'final' check (team_points in ('lineup', 'final', 'result'));

-- Endurance: wynik zespołu pokazywany w Galerii sław
alter table public.endurance_crews add column if not exists hall_of_fame boolean not null default false;

-- szybkie pobieranie: cały sezon jednym zapytaniem (te same reguły dostępu co zwykłe zapytania)
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

-- odśwież „schema cache” Supabase, żeby nowe kolumny były od razu widoczne dla strony
notify pgrst, 'reload schema';
