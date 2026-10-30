-- Aktualizacja bazy: logowanie przez Discord i powiązanie kont Discord z kierowcami.
-- Tylko DODAJE tabelę, kolumnę i funkcje — niczego nie usuwa ani nie zmienia w istniejących danych.
-- Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).
--
-- Zasady:
--  * pierwsze logowanie przez Discord tworzy wpis w discord_accounts,
--      - jest kierowca z takim samym nickiem (bez konta) → prośba o powiązanie, czeka na admina,
--      - nie ma → automatycznie powstaje nowy kierowca z nickiem z Discorda,
--  * przy każdym logowaniu nick i awatar powiązanego kierowcy są odświeżane z Discorda,
--  * admin może powiązać konto z dowolnym kierowcą; profil utworzony automatycznie zostaje wtedy
--    scalony z wybranym kierowcą (wyniki, składy, kary przechodzą na niego — nic nie ginie).

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

-- odśwież „schema cache” Supabase, żeby nowe kolumny i funkcje były od razu widoczne dla strony
notify pgrst, 'reload schema';
