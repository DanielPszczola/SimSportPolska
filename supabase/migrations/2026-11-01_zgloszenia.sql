-- Aktualizacja bazy: formularz zgłoszeń w ogłoszeniach.
-- Ogłoszenie może mieć formularz: własny (pola ustawia moderator, zgłoszenia trafiają do panelu) albo link do
-- zewnętrznego formularza. Formularz jest aktywny do podanej daty — do tej pory ogłoszenie jest też na stronie głównej.
-- Zgłaszać się mogą tylko osoby zalogowane przez Discord. Przyjęcie zgłoszenia dodaje kierowcę do rezerwy wybranego sezonu.
-- Niczego nie usuwa z danych. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).

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

-- moje zgłoszenia (status widzi tylko zgłaszający)
create or replace function public.my_signups()
returns json
language sql stable security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object('post_id', s.post_id, 'status', s.status, 'answers', s.answers, 'updated_at', s.updated_at)), '[]'::json)
  from public.signups s where s.user_id = auth.uid();
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
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_season uuid;
begin
  if not public.is_staff() then raise exception 'Brak uprawnień'; end if;
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

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
