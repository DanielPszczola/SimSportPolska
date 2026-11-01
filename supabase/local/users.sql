-- TYLKO LOKALNY PRE-PROD (Docker): konta testowe do sprawdzania strony różnymi rangami.
-- Wczytywane wyłącznie przez lokalną bazę (supabase/config.toml → db.seed oraz „preprod.bat login”).
-- NIGDY nie uruchamiaj na produkcji. Hasło wszystkich kont: test (konto główne: admin / admin — supabase/local/admin.sql).
--
--   test-admin      ranga admin
--   test-mod        ranga moderator
--   test-discord    zwykły użytkownik zalogowany „przez Discord” (konto udaje Discorda, logowanie hasłem)
do $$
declare
  acc record;
begin
  for acc in select * from (values
    ('00000000-0000-0000-0000-00000000a002'::uuid, 'test-admin@ssp.example.com', 'admin', false),
    ('00000000-0000-0000-0000-00000000a003'::uuid, 'test-mod@ssp.example.com', 'moderator', false),
    ('00000000-0000-0000-0000-00000000a004'::uuid, 'test-discord@ssp.example.com', 'user', true)
  ) as v (id, email, role, discord)
  loop
    if not exists (select 1 from auth.users where id = acc.id) then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', acc.id, 'authenticated', 'authenticated', acc.email,
        extensions.crypt('test', extensions.gen_salt('bf')), now(),
        case when acc.discord then '{"provider": "discord", "providers": ["discord"]}' else '{"provider": "email", "providers": ["email"]}' end::jsonb,
        -- dane, które przy prawdziwym logowaniu zapisuje Discord (z nich discord_login bierze nick)
        case when acc.discord then '{"provider_id": "100000000000000004", "sub": "100000000000000004", "full_name": "test_discord", "custom_claims": {"global_name": "Test Discord"}}' else '{}' end::jsonb,
        now(), now(), '', '', '', '');

      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), acc.id, acc.id::text, 'email',
        jsonb_build_object('sub', acc.id::text, 'email', acc.email, 'email_verified', true), now(), now(), now());
    end if;
    if acc.role <> 'user' then
      insert into public.user_roles (user_id, role) values (acc.id, acc.role)
        on conflict (user_id) do update set role = excluded.role, updated_at = now();
    end if;
  end loop;
end $$;
