-- Aktualizacja bazy: punkty karne kierowców.
-- Każda decyzja sędziów (kara w wyścigu) może dodać punkty karne: niezależnie od kary na wyścig albo jako osobna
-- decyzja typu 'license' („Tylko punkty karne”). Punkty sumują się w ramach sezonu i są tylko informacją:
-- o usunięciu kierowcy z ligi decyduje administracja.
-- Niczego nie usuwa z danych. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).

alter table public.penalties add column if not exists license_points int not null default 0 check (license_points >= 0);

-- nowy rodzaj decyzji: same punkty karne, bez kary na wyścig
do $$
declare
  c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.penalties'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%warning%' and pg_get_constraintdef(oid) not like '%license%';
  if c is not null then
    execute format('alter table public.penalties drop constraint %I', c);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.penalties'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''license''%') then
    alter table public.penalties add constraint penalties_type_check check (type in ('time', 'points', 'dsq', 'grid', 'warning', 'license'));
  end if;
end $$;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
