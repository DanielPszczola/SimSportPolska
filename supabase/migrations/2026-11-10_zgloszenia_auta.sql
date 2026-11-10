-- Aktualizacja bazy: pole „Wybór auta / zespołu” w formularzu zgłoszeń.
-- Pole pokazuje auta (zespoły) sezonu z formularza. Ustawienia pola (w form_fields): mode = 'suggest' (sugestia — nic
-- nie blokuje, dla lig z weryfikacją) albo 'reserve' (rezerwacja — wybór zajmuje miejsce, pełnego auta nie da się wybrać),
-- max = limit kierowców na auto. Zajęte miejsca = kierowcy w składzie auta + oczekujące rezerwacje (wycofanie, odrzucenie
-- i usunięcie zgłoszenia zwalniają miejsce). Przyjęcie zgłoszenia z autem wpisuje kierowcę od razu do tego auta.
-- Niczego nie usuwa z danych. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).
-- Wymaga wcześniejszych aktualizacji: 2026-11-01_zgloszenia.sql i 2026-11-04_zgloszenia_zdjecia.sql.

-- czy przyjęcie zgłoszenia założyło wpis w składzie (cofnięcie decyzji usuwa tylko taki wpis)
alter table public.signups add column if not exists created_entry boolean not null default false;

-- wolne miejsca w autach sezonu z formularza: kierowcy w składzie i oczekujące wybory (bez własnego zgłoszenia pytającego)
create or replace function public.signup_seats(p_post uuid)
returns json
language sql stable security definer
set search_path = public
as $$
  with fld as (
    select f ->> 'id' as id from public.posts p, jsonb_array_elements(coalesce(p.form_fields, '[]'::jsonb)) f
    where p.id = p_post and f ->> 'type' = 'car' limit 1
  )
  select coalesce(json_agg(json_build_object(
    'team_id', t.id,
    'lineup', (select count(*) from public.entries e where e.team_id = t.id and not e.is_reserve),
    'pending', (select count(*) from public.signups x, fld
                where x.post_id = p_post and x.status = 'pending' and x.user_id is distinct from auth.uid() and x.answers ->> fld.id = t.id::text)
  )), '[]'::json)
  from public.teams t join public.posts p on p.id = p_post
  where t.season_id = p.form_season_id;
$$;
grant execute on function public.signup_seats(uuid) to anon, authenticated;

-- moje zgłoszenia: identyfikator (podgląd dodanego zdjęcia) i auto, do którego trafił przyjęty kierowca
create or replace function public.my_signups()
returns json
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.signups_cleanup();
  return (select coalesce(json_agg(json_build_object('id', s.id, 'post_id', s.post_id, 'status', s.status, 'answers', s.answers, 'updated_at', s.updated_at,
                                                      'team_name', t.name)), '[]'::json)
          from public.signups s
          left join public.posts p on p.id = s.post_id
          left join public.entries e on s.status = 'accepted' and e.season_id = p.form_season_id and e.driver_id = s.driver_id
          left join public.teams t on t.id = e.team_id
          where s.user_id = auth.uid());
end;
$$;
grant execute on function public.my_signups() to authenticated;

-- wysłanie / poprawienie zgłoszenia (do końca zapisów, dopóki nie zostało rozpatrzone)
-- p_files: {id pola: zdjęcie w base64}; null = usuń zdjęcie, brak pola = zostaw dotychczasowe
create or replace function public.signup_submit(p_post uuid, p_answers jsonb, p_files jsonb default '{}'::jsonb)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  acc public.discord_accounts%rowtype;
  p public.posts%rowtype;
  cur public.signups%rowtype;
  f jsonb;
  v_field text;
  v text;
  clean jsonb := '{}'::jsonb;
  v_signup uuid;
  v_fields text[] := '{}';
  v_bytes bytea;
  v_mime text;
begin
  select * into acc from public.discord_accounts where user_id = auth.uid();
  if not found then raise exception 'Zgłoszenia przyjmujemy tylko od osób zalogowanych przez Discord'; end if;
  select * into p from public.posts where id = p_post;
  if not found or p.form_kind is distinct from 'internal' then raise exception 'To ogłoszenie nie ma formularza zgłoszeń'; end if;
  if not public.signup_open(p_post) then raise exception 'Zgłoszenia są już zamknięte'; end if;
  select * into cur from public.signups where post_id = p_post and user_id = auth.uid();
  if found and cur.status <> 'pending' then raise exception 'Twoje zgłoszenie zostało już rozpatrzone'; end if;

  insert into public.signups (post_id, user_id, display_name, avatar_url)
  values (p_post, auth.uid(), acc.display_name, acc.avatar_url)
  on conflict (post_id, user_id) do update
    set display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = now()
  returning id into v_signup;

  -- tylko pola z formularza; wymagane muszą być wypełnione (błąd cofa całą funkcję, także zapis powyżej)
  for f in select * from jsonb_array_elements(coalesce(p.form_fields, '[]'::jsonb)) loop
    v_field := f ->> 'id';
    v_fields := v_fields || v_field;

    if (f ->> 'type') = 'image' then
      if coalesce(p_files, '{}'::jsonb) ? v_field then
        delete from public.signup_files where signup_id = v_signup and field_id = v_field;
        if jsonb_typeof(p_files -> v_field) = 'string' then
          begin
            v_bytes := decode(p_files ->> v_field, 'base64');
          exception when others then
            raise exception 'Nieprawidłowy plik w polu: %', f ->> 'label';
          end;
          if octet_length(v_bytes) > 1048576 then raise exception 'Zdjęcie jest za duże (najwyżej 1 MB): %', f ->> 'label'; end if;
          v_mime := case
            when substring(v_bytes from 1 for 3) = '\xffd8ff'::bytea then 'image/jpeg'
            when substring(v_bytes from 1 for 8) = '\x89504e470d0a1a0a'::bytea then 'image/png'
            when substring(v_bytes from 1 for 4) = '\x52494646'::bytea and substring(v_bytes from 9 for 4) = '\x57454250'::bytea then 'image/webp'
          end;
          if v_mime is null then raise exception 'Dozwolone są tylko zdjęcia JPG, PNG i WebP: %', f ->> 'label'; end if;
          insert into public.signup_files (signup_id, field_id, mime, data) values (v_signup, v_field, v_mime, v_bytes);
        end if;
      end if;
      if exists (select 1 from public.signup_files where signup_id = v_signup and field_id = v_field) then
        clean := clean || jsonb_build_object(v_field, 'file');
      elsif coalesce((f ->> 'required')::boolean, false) then
        raise exception 'Dodaj zdjęcie: %', f ->> 'label';
      end if;
      continue;
    end if;

    v := left(btrim(coalesce(p_answers ->> v_field, '')), 2000);
    if (f ->> 'type') = 'checkbox' then v := case when v = 'true' then 'true' else '' end; end if;
    if coalesce((f ->> 'required')::boolean, false) and v = '' then
      raise exception 'Uzupełnij pole: %', f ->> 'label';
    end if;

    -- wybór auta: tylko auto z sezonu formularza; w trybie rezerwacji — tylko auto z wolnym miejscem
    if (f ->> 'type') = 'car' and v <> '' then
      if v !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'Wybierz auto z listy: %', f ->> 'label';
      end if;
      v := v::uuid::text; -- jedna postać zapisu (małe litery), żeby licznik miejsc widział każdy wybór
      if not exists (select 1 from public.teams t where t.id = v::uuid and t.season_id = p.form_season_id) then
        raise exception 'Wybierz auto z listy: %', f ->> 'label';
      end if;
      if (f ->> 'mode') = 'reserve' then
        perform 1 from public.teams where id = v::uuid for update; -- dwie osoby naraz nie zajmą ostatniego miejsca
        if (select count(*) from public.entries e where e.team_id = v::uuid and not e.is_reserve)
           + (select count(*) from public.signups x where x.post_id = p_post and x.status = 'pending' and x.id <> v_signup and x.answers ->> v_field = v)
           >= coalesce(nullif(f ->> 'max', '')::int, 2) then
          raise exception 'To auto jest już zajęte — wybierz inne';
        end if;
      end if;
    end if;

    if v <> '' then clean := clean || jsonb_build_object(v_field, v); end if;
  end loop;

  -- zdjęcia z pól usuniętych z formularza
  delete from public.signup_files where signup_id = v_signup and not (field_id = any (v_fields));
  update public.signups set answers = clean where id = v_signup;
  return public.my_signups();
end;
$$;
grant execute on function public.signup_submit(uuid, jsonb, jsonb) to authenticated;

-- poprzednia wersja funkcji (bez wyboru auta) — zastąpiona wersją z p_team
drop function if exists public.signup_decide(uuid, text);

-- decyzja: 'accepted' = kierowca trafia do sezonu z formularza: do auta wskazanego przez moderatora (p_team) albo do
-- rezerwy; 'rejected' / 'pending' = odrzucenie / cofnięcie decyzji
create or replace function public.signup_decide(p_signup uuid, p_status text, p_team uuid default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  s public.signups%rowtype;
  v_season uuid;
  v_fields jsonb;
  v_car jsonb;
  acc public.discord_accounts%rowtype;
  v_driver uuid;
  v_team uuid := p_team;
  v_entry public.entries%rowtype;
  v_created boolean := false;
  v_me text;
begin
  if not public.is_staff() then raise exception 'Brak uprawnień'; end if;
  if p_status not in ('pending', 'accepted', 'rejected') then raise exception 'Nieprawidłowy status'; end if;
  select * into s from public.signups where id = p_signup for update;
  if not found then raise exception 'Nie ma takiego zgłoszenia'; end if;
  select form_season_id, form_fields into v_season, v_fields from public.posts where id = s.post_id;
  select f into v_car from jsonb_array_elements(coalesce(v_fields, '[]'::jsonb)) f where f ->> 'type' = 'car' limit 1;
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

    -- auto wskazuje moderator (p_team — zwykle auto wybrane w zgłoszeniu); bez p_team kierowca trafia do rezerwy
    if v_team is not null then
      if not exists (select 1 from public.teams where id = v_team and season_id = v_season) then
        raise exception 'To auto nie należy do sezonu z formularza';
      end if;
      perform 1 from public.teams where id = v_team for update;
      if v_car is not null and (select count(*) from public.entries e where e.team_id = v_team and not e.is_reserve and e.driver_id <> v_driver)
         >= coalesce(nullif(v_car ->> 'max', '')::int, 2) then
        raise exception 'W tym aucie nie ma już wolnego miejsca — przyjmij do rezerwy albo zwolnij miejsce w składzie';
      end if;
    end if;

    select * into v_entry from public.entries where season_id = v_season and driver_id = v_driver;
    if found and v_team is not null and v_entry.team_id is not null and v_entry.team_id <> v_team then
      raise exception 'Ten kierowca jest już w składzie innego auta w tym sezonie: % — przenieś go w składzie sezonu albo przyjmij do rezerwy',
        (select name from public.teams where id = v_entry.team_id);
    end if;
    if not found then
      insert into public.entries (season_id, driver_id, team_id, is_reserve) values (v_season, v_driver, v_team, v_team is null);
      v_created := true;
    elsif v_team is not null and v_entry.team_id is null then
      update public.entries set team_id = v_team, is_reserve = false where id = v_entry.id;
    end if;
    update public.signups set status = 'accepted', driver_id = v_driver, decided_by = v_me, decided_at = now(),
      created_entry = v_created or (s.status = 'accepted' and s.created_entry)
    where id = p_signup;
  else
    -- cofnięcie przyjęcia: zdejmujemy kierowcę ze składu, jeśli to przyjęcie go dodało (albo jest tylko w rezerwie),
    -- a nie ma jeszcze wyników ani zmian w składzie
    if s.status = 'accepted' and s.driver_id is not null and v_season is not null then
      delete from public.entries e
      where e.season_id = v_season and e.driver_id = s.driver_id and (s.created_entry or e.team_id is null)
        and not exists (select 1 from public.results r join public.races x on x.id = r.race_id where x.season_id = v_season and r.driver_id = s.driver_id)
        and not exists (select 1 from public.roster_changes c where c.season_id = v_season and (c.driver_in_id = s.driver_id or c.driver_out_id = s.driver_id));
    end if;
    update public.signups set status = p_status, created_entry = false,
      decided_by = case when p_status = 'pending' then null else v_me end,
      decided_at = case when p_status = 'pending' then null else now() end
    where id = p_signup;
  end if;
end;
$$;
grant execute on function public.signup_decide(uuid, text, uuid) to authenticated;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
