-- Aktualizacja bazy: głosowanie (ankieta) w ogłoszeniu — pytanie do społeczności z kilkoma odpowiedziami.
-- Ogłoszenie z głosowaniem: form_kind = 'poll', odpowiedzi w form_fields ([{id, label}]), koniec w form_until,
-- poll_multi = można zaznaczyć kilka odpowiedzi. Głosują osoby zalogowane przez Discord (jeden głos na konto,
-- do końca głosowania można go zmienić). Wyniki widać po oddaniu głosu i po zakończeniu głosowania.
-- 30 dni po zakończeniu pojedyncze głosy są usuwane — zostają tylko łączne wyniki (polityka prywatności).
-- Niczego nie usuwa z istniejących danych. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).
-- Wymaga wcześniejszych aktualizacji: 2026-11-01_zgloszenia.sql i 2026-11-02_prywatnosc.sql.

alter table public.posts add column if not exists poll_multi boolean not null default false;  -- wiele odpowiedzi
alter table public.posts add column if not exists poll_results jsonb;  -- łączne wyniki po usunięciu pojedynczych głosów
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'posts_form_kind_check' and pg_get_constraintdef(oid) not like '%poll%') then
    alter table public.posts drop constraint posts_form_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_form_kind_check') then
    alter table public.posts add constraint posts_form_kind_check check (form_kind in ('internal', 'external', 'poll'));
  end if;
end $$;

create table if not exists public.poll_votes (
  post_id uuid not null references public.posts (id) on delete cascade,
  voter text not null,                   -- 'u:<id konta>'; po odpięciu konta Discord — anonimowy 'x:<losowy>'
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, voter, option_id)
);
-- brak polityk = strona nie czyta tabeli bezpośrednio; głos i wyniki wyłącznie przez funkcje poniżej
alter table public.poll_votes enable row level security;

-- czy głosowanie trwa
create or replace function public.poll_open(p_post uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.posts p where p.id = p_post and p.form_kind = 'poll' and (p.form_until is null or now() < p.form_until));
$$;
grant execute on function public.poll_open(uuid) to anon, authenticated;

-- łączne wyniki: {"votes": {id odpowiedzi: liczba}, "voters": liczba głosujących}
create or replace function public.poll_tally(p_post uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'votes', coalesce((select jsonb_object_agg(option_id, n) from (select option_id, count(*) n from public.poll_votes where post_id = p_post group by option_id) x), '{}'::jsonb),
    'voters', (select count(distinct voter) from public.poll_votes where post_id = p_post));
$$;
revoke all on function public.poll_tally(uuid) from public, anon, authenticated;

-- 30 dni po zakończeniu: zapisujemy łączne wyniki w ogłoszeniu i usuwamy pojedyncze głosy
create or replace function public.poll_cleanup()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select p.id from public.posts p
           where p.form_kind = 'poll' and p.form_until is not null and p.form_until < now() - interval '30 days'
             and exists (select 1 from public.poll_votes v where v.post_id = p.id) loop
    update public.posts set poll_results = public.poll_tally(r.id) where id = r.id;
    delete from public.poll_votes where post_id = r.id;
  end loop;
end;
$$;
revoke all on function public.poll_cleanup() from public, anon, authenticated;

-- stan głosowania: czy trwa, mój głos, wyniki (po oddaniu głosu, po zakończeniu albo dla moderatora)
create or replace function public.poll_state(p_post uuid)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  p public.posts%rowtype;
  v_open boolean;
  v_my text[];
begin
  perform public.poll_cleanup();
  select * into p from public.posts where id = p_post and form_kind = 'poll';
  if not found then raise exception 'To ogłoszenie nie ma głosowania'; end if;
  v_open := public.poll_open(p_post);
  if auth.uid() is not null then
    select array_agg(option_id) into v_my from public.poll_votes where post_id = p_post and voter = 'u:' || auth.uid();
  end if;
  return json_build_object(
    'open', v_open,
    'my', coalesce(v_my, '{}'),
    'results', case when not v_open or v_my is not null or public.is_staff() then coalesce(p.poll_results, public.poll_tally(p_post)) end);
end;
$$;
grant execute on function public.poll_state(uuid) to anon, authenticated;

-- oddanie / zmiana głosu (do końca głosowania)
create or replace function public.poll_vote(p_post uuid, p_options text[])
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  p public.posts%rowtype;
  v_voter text := 'u:' || auth.uid();
  v_opts text[];
begin
  if not exists (select 1 from public.discord_accounts where user_id = auth.uid()) then
    raise exception 'Głosować mogą osoby zalogowane przez Discord';
  end if;
  select * into p from public.posts where id = p_post and form_kind = 'poll';
  if not found then raise exception 'To ogłoszenie nie ma głosowania'; end if;
  if not public.poll_open(p_post) then raise exception 'Głosowanie jest już zakończone'; end if;
  v_opts := array(select distinct x from unnest(coalesce(p_options, '{}')) x);
  if cardinality(v_opts) = 0 then raise exception 'Wybierz odpowiedź'; end if;
  if not p.poll_multi and cardinality(v_opts) > 1 then raise exception 'W tym głosowaniu można wybrać tylko jedną odpowiedź'; end if;
  if exists (select 1 from unnest(v_opts) o
             where not exists (select 1 from jsonb_array_elements(coalesce(p.form_fields, '[]'::jsonb)) f where f ->> 'id' = o)) then
    raise exception 'Nieprawidłowa odpowiedź';
  end if;
  delete from public.poll_votes where post_id = p_post and voter = v_voter;
  insert into public.poll_votes (post_id, voter, option_id) select p_post, v_voter, o from unnest(v_opts) o;
  return public.poll_state(p_post);
end;
$$;
grant execute on function public.poll_vote(uuid, text[]) to authenticated;

-- „Odepnij konto Discord”: także głosy w ankietach zostają w wynikach, ale bez powiązania z kontem
create or replace function public.discord_unlink_me()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_anon text := 'x:' || gen_random_uuid();  -- jeden anonimowy identyfikator na wszystkie głosy tej osoby
  acc public.discord_accounts%rowtype;
begin
  if v_uid is null then raise exception 'Nie jesteś zalogowany'; end if;
  select * into acc from public.discord_accounts where user_id = v_uid;
  if not found then raise exception 'To nie jest konto Discord'; end if;
  if acc.driver_id is not null then
    update public.drivers set avatar_url = null where id = acc.driver_id;
  end if;
  update public.dotd_votes set voter = 'x:' || gen_random_uuid(), user_id = null where voter = 'u:' || v_uid;
  update public.poll_votes set voter = v_anon where voter = 'u:' || v_uid;
  delete from auth.users where id = v_uid;  -- razem z nim: discord_accounts, ranga, zgłoszenia
end;
$$;
grant execute on function public.discord_unlink_me() to authenticated;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
