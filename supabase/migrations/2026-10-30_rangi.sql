-- Aktualizacja bazy: rangi użytkowników (admin / moderator / użytkownik) i konto główne „admin”.
-- Dodaje tabelę i funkcje oraz zmienia reguły zapisu (RLS). Niczego nie usuwa z danych ligi.
-- Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).
--
-- Rangi:
--  * admin         = pełny dostęp: zarządzanie ligą + rangi użytkowników + konta Discord,
--  * moderator     = zarządzanie ligą: sezony, kalendarz, zespoły, składy, wyniki, kary, kierowcy, tory, Endurance,
--  * użytkownik    = domyślnie każdy nowy (np. zalogowany przez Discord) — bez dostępu do panelu.
--  Konto o loginie „admin” (e-mail admin@ssp.example.com) to konto główne: zawsze admin, jego rangi nie da się
--  zmienić — dzięki temu nikt nie odetnie wszystkich od panelu.

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
           case when u.email like '%@ssp.example.com' then split_part(u.email, '@', 1) else u.email::text end,
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

-- reguły zapisu: dane ligi może zmieniać admin i moderator
do $$
declare t text;
begin
  foreach t in array array['tracks', 'seasons', 'teams', 'drivers', 'entries', 'roster_changes', 'races', 'results', 'penalties', 'endurance_events', 'endurance_crews', 'endurance_cars'] loop
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('drop policy if exists "staff write" on public.%I', t);
    execute format('create policy "staff write" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;
-- grafiki (logo, bolidy, tory, auta) — wgrywa admin i moderator
drop policy if exists "images admin write" on storage.objects;
drop policy if exists "images staff write" on storage.objects;
create policy "images staff write" on storage.objects
  for all to authenticated
  using (bucket_id = 'images' and public.is_staff())
  with check (bucket_id = 'images' and public.is_staff());
-- konta Discord (powiązania, scalanie kierowców) i rangi — tylko admin (bez zmian)

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
