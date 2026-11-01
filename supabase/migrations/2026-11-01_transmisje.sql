-- Aktualizacja bazy: transmisje i czas trwania wyścigów (ligi F1, LMU i wydarzenia „Inne”).
-- Na stronie głównej trwający wyścig pojawia się w sekcji „Trwa teraz” (z transmisją w tle i przyciskiem „Oglądaj”).
-- Po upływie czasu trwania wyścig przestaje być „trwający”, ale wyniki nadal zatwierdza admin.
-- Tylko dodaje kolumny — niczego nie usuwa. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).

alter table public.races add column if not exists duration_minutes int;   -- puste = 120 minut
alter table public.races add column if not exists youtube_url text;
alter table public.races add column if not exists twitch_url text;
alter table public.races add column if not exists tiktok_url text;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
