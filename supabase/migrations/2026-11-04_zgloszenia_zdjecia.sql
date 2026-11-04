-- Aktualizacja bazy: pole „Zdjęcie” w formularzu zgłoszeń (np. zrzut z gry jako dowód czasu okrążenia).
-- Zdjęcia są prywatne, dlatego nie trafiają do publicznego magazynu plików: leżą w tabeli signup_files, a odczytać je może
-- tylko autor zgłoszenia i moderator (funkcja signup_file). Znikają razem ze zgłoszeniem: po wycofaniu, po 30 dniach
-- od końca zapisów, po usunięciu ogłoszenia i po odpięciu konta Discord.
-- Baza przyjmuje tylko JPG, PNG i WebP (rozpoznawane po zawartości pliku), najwyżej 1 MB na zdjęcie.
-- Niczego nie usuwa z danych. Można uruchomić wielokrotnie (Supabase → SQL Editor → wklej → Run).
-- Wymaga wcześniejszej aktualizacji: 2026-11-01_zgloszenia.sql.

create table if not exists public.signup_files (
  signup_id uuid not null references public.signups (id) on delete cascade,
  field_id text not null,                -- pole formularza
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null check (octet_length(data) <= 1048576),
  created_at timestamptz not null default now(),
  primary key (signup_id, field_id)
);
-- brak polityk = strona nie czyta tabeli bezpośrednio; zapis i odczyt wyłącznie przez funkcje
alter table public.signup_files enable row level security;

-- zdjęcie zgłoszenia: dla autora zgłoszenia i moderatora
create or replace function public.signup_file(p_signup uuid, p_field text)
returns json
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_staff() and not exists (select 1 from public.signups where id = p_signup and user_id = auth.uid()) then
    raise exception 'Brak uprawnień';
  end if;
  return (select json_build_object('mime', f.mime, 'data', translate(encode(f.data, 'base64'), E'\n', ''))
          from public.signup_files f where f.signup_id = p_signup and f.field_id = p_field);
end;
$$;
revoke all on function public.signup_file(uuid, text) from public, anon;
grant execute on function public.signup_file(uuid, text) to authenticated;

-- moje zgłoszenia: także identyfikator, żeby przy poprawianiu pokazać dodane zdjęcie
create or replace function public.my_signups()
returns json
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.signups_cleanup();
  return (select coalesce(json_agg(json_build_object('id', s.id, 'post_id', s.post_id, 'status', s.status, 'answers', s.answers, 'updated_at', s.updated_at)), '[]'::json)
          from public.signups s where s.user_id = auth.uid());
end;
$$;
grant execute on function public.my_signups() to authenticated;

-- poprzednia wersja funkcji (bez zdjęć) — zastąpiona wersją z p_files
drop function if exists public.signup_submit(uuid, jsonb);

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
    if v <> '' then clean := clean || jsonb_build_object(v_field, v); end if;
  end loop;

  -- zdjęcia z pól usuniętych z formularza
  delete from public.signup_files where signup_id = v_signup and not (field_id = any (v_fields));
  update public.signups set answers = clean where id = v_signup;
  return public.my_signups();
end;
$$;
grant execute on function public.signup_submit(uuid, jsonb, jsonb) to authenticated;

-- odśwież „schema cache” Supabase
notify pgrst, 'reload schema';
