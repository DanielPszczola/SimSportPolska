-- Aktualizacja bazy: pogoda i pora dnia w grze dla rund ligi LMU.
-- Tylko DODAJE dwie kolumny do kalendarza — niczego nie usuwa ani nie zmienia w istniejących danych.
-- Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).

alter table public.races add column if not exists weather text;    -- pogoda ustawiona w grze
alter table public.races add column if not exists game_time text;  -- pora dnia w grze, godzina startu "HH:MM" (nie termin zawodów)

-- odśwież „schema cache” Supabase, żeby nowe kolumny były od razu widoczne dla strony
notify pgrst, 'reload schema';
