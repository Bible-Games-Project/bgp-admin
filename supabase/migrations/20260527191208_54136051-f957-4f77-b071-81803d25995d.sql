
DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
BEGIN
  -- Delete old user (cascades to admins via auth.users delete, but admins has no FK; clean explicitly)
  DELETE FROM public.admins WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'pau.sabe@icloud.com');
  DELETE FROM auth.users WHERE email = 'pau.sabe@icloud.com';

  -- Create new user with bcrypt-hashed password
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    'pau.sabe@icloud.com',
    crypt('IeqTMZdxisheTYeoCT7S', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(),
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', 'pau.sabe@icloud.com', 'email_verified', true),
    'email',
    new_user_id::text,
    now(), now(), now()
  );

  INSERT INTO public.admins (user_id) VALUES (new_user_id);
END $$;
