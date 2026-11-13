-- Aktualizacja bazy: głosowanie na kierowcę dnia uruchamia i kończy moderator (Zarządzanie → wyścig → „W trakcie wyścigu”),
-- zamiast otwierać się samo od startu wyścigu. Po uruchomieniu wszyscy na stronie widzą przycisk głosowania.
-- Skład startowy wyścigu (Zarządzanie → wyścig → „Przed wyścigiem”): kto faktycznie jedzie — tylko te osoby są
-- w głosowaniu na kierowcę dnia (bez ustawionego składu startowego — skład rundy z kafelka „Składy”, jak dotąd).
-- Głosowanie zamyka się: przyciskiem „Zakończ głosowanie”, po zatwierdzeniu wyników albo samo 12 godzin po uruchomieniu
-- (zabezpieczenie, gdyby nikt go nie zamknął). Skróty adresów IP znikają od razu po zamknięciu (polityka prywatności).
-- Wyniki dotychczasowych wyścigów zostają bez zmian. Niczego nie usuwa z danych.
-- Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).
-- Wymaga wcześniejszych aktualizacji: 2026-11-01_kierowca_dnia.sql i 2026-11-02_prywatnosc.sql.

alter table public.races add column if not exists dotd_started_at timestamptz;  -- kiedy moderator uruchomił głosowanie
alter table public.races add column if not exists dotd_ended_at timestamptz;    -- kiedy je zakończył
-- skład startowy wyścigu: [{driver_id, team_id}] — kto faktycznie jedzie (bez nieobecnych, z zastępstwami);
-- null = skład rundy z kafelka „Składy”. Z niego biorą się kandydaci do głosowania na kierowcę dnia.
alter table public.races add column if not exists start_lineup jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'races_start_lineup_array') then
    alter table public.races add constraint races_start_lineup_array check (start_lineup is null or jsonb_typeof(start_lineup) = 'array');
  end if;
end $$;

-- głosowanie otwarte: uruchomione przez moderatora, jeszcze niezakończone, wyścig niezatwierdzony, najwyżej 12 h
create or replace function public.dotd_window_open(p_race uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.races r
    where r.id = p_race and r.status <> 'completed'
      and r.dotd_started_at is not null and r.dotd_ended_at is null
      and now() < r.dotd_started_at + interval '12 hours'
  );
$$;
grant execute on function public.dotd_window_open(uuid) to anon, authenticated;

-- trwające głosowania (dla przycisku na każdej stronie): wyścig, sezon i tor
create or replace function public.dotd_live()
returns json
language sql stable security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
    'race_id', r.id, 'season_id', r.season_id, 'season', s.name, 'series', s.series,
    'round', r.round, 'kind', r.kind, 'track', t.name, 'country_code', t.country_code, 'started_at', r.dotd_started_at
  ) order by r.dotd_started_at), '[]'::json)
  from public.races r
  join public.seasons s on s.id = r.season_id
  left join public.tracks t on t.id = r.track_id
  where r.status <> 'completed' and r.dotd_started_at is not null and r.dotd_ended_at is null
    and now() < r.dotd_started_at + interval '12 hours';
$$;
grant execute on function public.dotd_live() to anon, authenticated;

-- moderator: uruchom (p_open = true; także ponownie po zakończeniu — oddane głosy zostają) albo zakończ głosowanie
create or replace function public.dotd_set_open(p_race uuid, p_open boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r public.races%rowtype;
begin
  if not public.is_staff() then raise exception 'Brak uprawnień'; end if;
  select * into r from public.races where id = p_race for update;
  if not found then raise exception 'Nie ma takiego wyścigu'; end if;
  if p_open then
    if r.status = 'completed' then raise exception 'Wyścig jest już zatwierdzony — głosowanie jest zamknięte'; end if;
    update public.races set dotd_started_at = now(), dotd_ended_at = null where id = p_race;
  else
    update public.races set dotd_ended_at = now() where id = p_race and dotd_started_at is not null and dotd_ended_at is null;
    update public.dotd_votes set ip_hash = null where race_id = p_race and ip_hash is not null;
  end if;
end;
$$;
grant execute on function public.dotd_set_open(uuid, boolean) to authenticated;

-- moderator: wyniki na żywo w trakcie głosowania (publicznie widać je dopiero po oddaniu głosu albo po zamknięciu)
create or replace function public.dotd_staff_results(p_race uuid)
returns json
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Brak uprawnień'; end if;
  return coalesce((
    select json_agg(json_build_object('driver_id', driver_id, 'votes', votes) order by votes desc)
    from (select driver_id, count(*)::int votes from public.dotd_votes where race_id = p_race group by driver_id) x
  ), '[]'::json);
end;
$$;
grant execute on function public.dotd_staff_results(uuid) to authenticated;

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
    raise exception 'Głosowanie na kierowcę dnia nie jest teraz otwarte — uruchamia je organizator w trakcie wyścigu';
  end if;
  -- kandydaci: skład startowy tego wyścigu (jeśli ustawiony w panelu), inaczej kierowcy ze składu sezonu
  if not exists (
    select 1 from public.races r
    where r.id = p_race and (
      (r.start_lineup is not null and r.start_lineup @> jsonb_build_array(jsonb_build_object('driver_id', p_driver)))
      or (r.start_lineup is null and exists (select 1 from public.entries e where e.season_id = r.season_id and e.driver_id = p_driver))
    )
  ) then
    raise exception 'Ten kierowca nie startuje w tym wyścigu';
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

-- scalenie dwóch profili kierowcy (teraz także głosy na kierowcę dnia, przyjęte zgłoszenia i składy startowe): wszystko z p_from przechodzi na p_to, p_from znika
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
  -- głosy na kierowcę dnia (inaczej zniknęłyby razem z profilem), przyjęte zgłoszenia i składy startowe wyścigów
  update public.dotd_votes set driver_id = p_to where driver_id = p_from;
  update public.signups set driver_id = p_to where driver_id = p_from;
  update public.races r set start_lineup = (
      select jsonb_agg(case when e ->> 'driver_id' = p_from::text then jsonb_set(e, '{driver_id}', to_jsonb(p_to::text)) else e end)
      from jsonb_array_elements(r.start_lineup) e)
    where r.start_lineup @> jsonb_build_array(jsonb_build_object('driver_id', p_from));
  delete from public.drivers where id = p_from;
end;
$$;
grant execute on function public.merge_drivers(uuid, uuid) to authenticated;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
