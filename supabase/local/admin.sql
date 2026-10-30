-- TYLKO LOKALNY PRE-PROD (Docker): konto admina strony — login „admin”, hasło „admin”.
-- Wczytywane wyłącznie przez lokalną bazę (supabase/config.toml → db.seed). NIGDY nie uruchamiaj na produkcji.
do $$
declare
  uid uuid := '00000000-0000-0000-0000-00000000a001';
begin
  if exists (select 1 from auth.users where id = uid) then return; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'admin@ssp.example.com',
    extensions.crypt('admin', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, 'email',
    jsonb_build_object('sub', uid::text, 'email', 'admin@ssp.example.com', 'email_verified', true), now(), now(), now());

  insert into public.admins (user_id) values (uid) on conflict do nothing;
end $$;
