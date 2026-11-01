-- Aktualizacja bazy: wydarzenia i serie w zakładce „Inne” (np. seria F2, pojedyncze wydarzenie z własnymi klasami aut).
-- Wydarzenie to zwykły sezon z series = 'inne' — kalendarz, zespoły/auta, składy, wyniki i kary działają jak w ligach.
-- Niczego nie usuwa z danych: dodaje kolumny i poszerza dozwolone wartości. Można uruchomić wielokrotnie
-- (Supabase → SQL Editor → wklej → Run).

-- ustawienia wydarzenia
alter table public.seasons add column if not exists event_format text not null default 'series';   -- 'series' | 'single'
alter table public.seasons add column if not exists roster_mode text not null default 'teams';      -- 'teams' (jak F1) | 'cars' (jak LMU)
alter table public.seasons add column if not exists class_defs jsonb not null default '[]'::jsonb;  -- własne klasy: [{id, label, color}]
alter table public.seasons add column if not exists description text not null default '';

do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.seasons'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%(series = %' and pg_get_constraintdef(oid) not like '%inne%'
  loop
    execute format('alter table public.seasons drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seasons'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%(series = %') then
    alter table public.seasons add constraint seasons_series_inne_check check (series in ('f1', 'lmu', 'inne'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seasons'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%(event_format = %') then
    alter table public.seasons add constraint seasons_event_format_check check (event_format in ('series', 'single'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seasons'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%(roster_mode = %') then
    alter table public.seasons add constraint seasons_roster_mode_check check (roster_mode in ('teams', 'cars'));
  end if;
  -- własne klasy aut: stara reguła dopuszczała tylko F1 / GT3 / LMP / HY
  for c in select conrelid::regclass::text as tbl, conname from pg_constraint
    where conrelid in ('public.teams'::regclass, 'public.results'::regclass) and contype = 'c'
      and pg_get_constraintdef(oid) like '%car_class%' and pg_get_constraintdef(oid) like '%''HY''%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.teams'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(car_class)%') then
    alter table public.teams add constraint teams_car_class_len check (char_length(car_class) <= 24);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.results'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(car_class)%') then
    alter table public.results add constraint results_car_class_len check (char_length(car_class) <= 24);
  end if;
end $$;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
