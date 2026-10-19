-- Aktualizacja bazy: Garaż aut dla LMU Endurance.
-- Tylko DODAJE nową tabelę i jedną kolumnę — niczego nie usuwa ani nie zmienia w istniejących danych.
-- Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).

create table if not exists public.endurance_cars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  car_class text check (car_class in ('HY', 'LMP', 'GT3')),
  image_url text,
  created_at timestamptz not null default now()
);

alter table public.endurance_crews add column if not exists car_id uuid references public.endurance_cars (id) on delete set null;

-- dostęp: każdy czyta, zapisuje tylko admin (tak jak pozostałe tabele)
alter table public.endurance_cars enable row level security;
drop policy if exists "public read" on public.endurance_cars;
create policy "public read" on public.endurance_cars for select using (true);
drop policy if exists "admin write" on public.endurance_cars;
create policy "admin write" on public.endurance_cars for all to authenticated using (public.is_admin()) with check (public.is_admin());
