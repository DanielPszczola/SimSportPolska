-- Aktualizacja bazy: prywatność (RODO).
--  1. Panel → Użytkownicy nie pokazuje adresów e-mail kont Discord (nie są potrzebne do prowadzenia ligi).
--  2. Skrót adresu IP z głosowania na kierowcę dnia jest kasowany po zakończeniu głosowania
--     (służy tylko do limitu głosów z jednej sieci w trakcie wyścigu). Wynik głosowania zostaje.
--  3. „Odepnij konto Discord” (Moje konto): użytkownik sam usuwa swoje konto i dane z Discorda.
--     Profil kierowcy z nickiem i wynikami zostaje (historia ligi), znika z niego tylko awatar z Discorda.
-- Niczego poza tym nie usuwa. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).
-- Wymaga wcześniejszych aktualizacji: 2026-10-30_rangi.sql, 2026-10-30_discord.sql, 2026-11-01_kierowca_dnia.sql.

-- ---------- 1. lista użytkowników bez adresów e-mail kont Discord ----------
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
           -- login tylko dla kont z loginem i hasłem (techniczny adres <login>@ssp.example.com); e-maili z Discorda nie pokazujemy
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

-- ---------- 2. skrót IP z głosowania tylko na czas głosowania ----------
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

-- oddanie głosu (jeden na wyścig, bez zmiany); przy okazji sprząta skróty IP zakończonych głosowań
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

-- jednorazowo: skróty IP z głosowań, które już się zakończyły
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
  acc public.discord_accounts%rowtype;
begin
  if v_uid is null then raise exception 'Nie jesteś zalogowany'; end if;
  select * into acc from public.discord_accounts where user_id = v_uid;
  if not found then raise exception 'To nie jest konto Discord'; end if;
  if acc.driver_id is not null then
    update public.drivers set avatar_url = null where id = acc.driver_id;
  end if;
  update public.dotd_votes set voter = 'x:' || gen_random_uuid(), user_id = null where voter = 'u:' || v_uid;
  delete from auth.users where id = v_uid;  -- razem z nim: discord_accounts, ranga, zgłoszenia
end;
$$;
grant execute on function public.discord_unlink_me() to authenticated;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
