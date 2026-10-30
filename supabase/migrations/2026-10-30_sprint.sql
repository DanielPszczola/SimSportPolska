-- Aktualizacja bazy: wyścigi sprinterskie (weekend sprinterski jak we współczesnej F1).
-- Sprint to osobny wiersz w tabeli races z kind = 'sprint' i TYM SAMYM numerem rundy co wyścig główny.
-- Punktacja sprintu jak w F1: 8-7-6-5-4-3-2-1 dla pierwszej ósemki (bez punktów za pole i najszybsze okrążenie).
-- Tylko dodaje kolumnę — niczego nie usuwa. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).

alter table public.races add column if not exists kind text not null default 'race';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'races_kind_check') then
    alter table public.races add constraint races_kind_check check (kind in ('race', 'sprint'));
  end if;
end $$;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
