-- Aktualizacja bazy: prośba o zmianę nicku (Moje konto → „Zmień nick”) — np. na nick używany w startach.
-- Prośbę rozpatruje moderator (Zarządzanie → Baza danych → Kierowcy). Po zatwierdzeniu nick kierowcy zmienia się
-- w wynikach, klasyfikacjach i profilu i NIE wraca już do nicku z Discorda przy logowaniu. Tak samo ręczna zmiana nicku
-- w panelu (wcześniej logowanie przez Discord nadpisywało ją nickiem z Discorda).
-- Niczego nie usuwa z danych. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).
-- Wymaga wcześniejszej aktualizacji: 2026-10-30_discord.sql.

-- prośba o zmianę nicku (Moje konto → „Zmień nick”) i nick ustawiony przez administrację (opis: migrations/2026-11-11_prosba_o_nick.sql)
alter table public.discord_accounts add column if not exists nick_request text;            -- nick, o który prosi użytkownik
alter table public.discord_accounts add column if not exists nick_request_at timestamptz;
alter table public.discord_accounts add column if not exists nick_rejected text;           -- ostatnia odrzucona prośba (informacja dla użytkownika)
alter table public.discord_accounts add column if not exists nick_locked boolean not null default false;  -- nick ustawiła administracja: logowanie go nie nadpisuje

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
    'claim_driver_id', a.claim_driver_id, 'claim_nick', c.nick,
    'nick_request', a.nick_request, 'nick_request_at', a.nick_request_at, 'nick_rejected', a.nick_rejected, 'nick_locked', a.nick_locked)
  from public.discord_accounts a
  left join public.drivers d on d.id = a.driver_id
  left join public.drivers c on c.id = a.claim_driver_id
  where a.user_id = p_user;
$$;
revoke all on function public.discord_state(uuid) from public, anon, authenticated;

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
    -- nick i awatar kierowcy jak na Discordzie (o ile nikt inny nie ma już takiego nicku);
    -- nick ustawiony przez administrację (prośba o nick albo ręczna zmiana w panelu) zostaje
    if acc.driver_id is not null then
      update public.drivers set avatar_url = v_avatar where id = acc.driver_id;
      if not acc.nick_locked and not exists (select 1 from public.drivers where lower(nick) = lower(v_name) and id <> acc.driver_id) then
        perform set_config('ssp.nick_sync', '1', true); -- nick z Discorda — to nie jest ręczna zmiana (trigger drivers_nick_lock)
        update public.drivers set nick = v_name where id = acc.driver_id and nick is distinct from v_name;
        perform set_config('ssp.nick_sync', '', true);
      end if;
    end if;
  end if;

  return public.discord_state(u.id);
end;
$$;
grant execute on function public.discord_login() to authenticated;

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
  if acc.display_name is not null and not acc.nick_locked and not exists (select 1 from public.drivers where lower(nick) = lower(acc.display_name) and id <> p_driver) then
    perform set_config('ssp.nick_sync', '1', true); -- nick z Discorda przy powiązaniu — to nie jest ręczna zmiana
    update public.drivers set nick = acc.display_name where id = p_driver;
    perform set_config('ssp.nick_sync', '', true);
  end if;
  return public.discord_state(p_user);
end;
$$;
grant execute on function public.discord_link(uuid, uuid) to authenticated;

-- ręczna zmiana nicku kierowcy w panelu (Baza danych → Kierowcy) blokuje nick przed nadpisaniem z Discorda
create or replace function public.drivers_nick_lock()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.nick is distinct from old.nick and coalesce(current_setting('ssp.nick_sync', true), '') <> '1' then
    update public.discord_accounts
      set nick_locked = true,
          nick_request = case when lower(nick_request) = lower(new.nick) then null else nick_request end,
          nick_request_at = case when lower(nick_request) = lower(new.nick) then null else nick_request_at end
      where driver_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists drivers_nick_lock on public.drivers;
create trigger drivers_nick_lock after update of nick on public.drivers
  for each row execute function public.drivers_nick_lock();

-- użytkownik: prośba o nick używany w startach (null = anuluj prośbę)
create or replace function public.nick_request(p_nick text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  acc public.discord_accounts%rowtype;
  v text := left(btrim(regexp_replace(coalesce(p_nick, ''), '\s+', ' ', 'g')), 40);
begin
  select * into acc from public.discord_accounts where user_id = auth.uid() for update;
  if not found then raise exception 'Najpierw zaloguj się przez Discord'; end if;
  if p_nick is null then
    update public.discord_accounts set nick_request = null, nick_request_at = null where user_id = auth.uid();
    return public.discord_state(auth.uid());
  end if;
  if acc.driver_id is null then raise exception 'Konto nie ma jeszcze profilu kierowcy — poczekaj na powiązanie z profilem'; end if;
  if char_length(v) < 2 then raise exception 'Nick musi mieć co najmniej 2 znaki'; end if;
  if exists (select 1 from public.drivers where id = acc.driver_id and nick = v) then raise exception 'To już jest Twój nick'; end if;
  if exists (select 1 from public.drivers where lower(nick) = lower(v) and id <> acc.driver_id) then
    raise exception 'Nick „%” ma już inny kierowca w lidze', v;
  end if;
  update public.discord_accounts set nick_request = v, nick_request_at = now(), nick_rejected = null where user_id = auth.uid();
  return public.discord_state(auth.uid());
end;
$$;
grant execute on function public.nick_request(text) to authenticated;

-- moderator: prośby o zmianę nicku do rozpatrzenia
create or replace function public.nick_requests()
returns json
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Brak uprawnień'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'user_id', a.user_id, 'display_name', a.display_name, 'username', a.username, 'avatar_url', a.avatar_url,
      'driver_id', a.driver_id, 'driver_nick', d.nick, 'nick_request', a.nick_request, 'nick_request_at', a.nick_request_at
    ) order by a.nick_request_at)
    from public.discord_accounts a
    left join public.drivers d on d.id = a.driver_id
    where a.nick_request is not null
  ), '[]'::json);
end;
$$;
grant execute on function public.nick_requests() to authenticated;

-- moderator: zatwierdzenie (nick kierowcy się zmienia i nie wraca do nicku z Discorda) albo odrzucenie prośby
create or replace function public.nick_decide(p_user uuid, p_accept boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  acc public.discord_accounts%rowtype;
begin
  if not public.is_staff() then raise exception 'Brak uprawnień'; end if;
  select * into acc from public.discord_accounts where user_id = p_user for update;
  if not found or acc.nick_request is null then raise exception 'Ta prośba została już rozpatrzona'; end if;
  if p_accept then
    if acc.driver_id is null then raise exception 'Konto nie ma profilu kierowcy'; end if;
    if exists (select 1 from public.drivers where lower(nick) = lower(acc.nick_request) and id <> acc.driver_id) then
      raise exception 'Nick „%” ma już inny kierowca w lidze', acc.nick_request;
    end if;
    update public.drivers set nick = acc.nick_request where id = acc.driver_id;
    update public.discord_accounts set nick_locked = true, nick_request = null, nick_request_at = null, nick_rejected = null where user_id = p_user;
  else
    update public.discord_accounts set nick_rejected = acc.nick_request, nick_request = null, nick_request_at = null where user_id = p_user;
  end if;
end;
$$;
grant execute on function public.nick_decide(uuid, boolean) to authenticated;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
