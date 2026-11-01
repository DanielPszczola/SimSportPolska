-- Aktualizacja bazy: zakładka „Inne” (open lobby) i blok „Ogłoszenia” na stronie głównej.
-- Tylko dodaje dwie nowe tabele — niczego nie usuwa. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).

-- open lobby: luźne jazdy z transmisją (bez zapisów, składów i wyników)
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

-- ogłoszenia (moderator i wyżej): tytuł, zdjęcie, treść
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  image_url text,                        -- Supabase Storage, bucket images
  pinned boolean not null default false,
  author text,                           -- nick autora w chwili publikacji
  created_at timestamptz not null default now()
);

create index if not exists lobbies_start_idx on public.lobbies (start_at);
create index if not exists posts_created_idx on public.posts (created_at);

-- każdy może czytać, zapis: admin i moderator
do $$
declare t text;
begin
  foreach t in array array['lobbies', 'posts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('drop policy if exists "staff write" on public.%I', t);
    execute format('create policy "staff write" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
