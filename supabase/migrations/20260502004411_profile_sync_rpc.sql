-- ALEX-002: authenticated profile sync for first sign-in.

alter table public.profiles
  add column if not exists email text;

alter table public.profiles
  add constraint profiles_email_not_empty
  check (email is null or length(btrim(email)) > 0);

create or replace function public.ensure_profile(
  p_email text,
  p_display_name text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_display_name text := nullif(btrim(p_display_name), '');
  v_profile public.profiles;
begin
  if v_auth_user_id is null then
    raise exception 'ensure_profile requires authenticated user'
      using errcode = '28000';
  end if;

  if v_email is null
    or length(v_email) = 0
    or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email'
      using errcode = '22023';
  end if;

  insert into public.profiles (
    auth_user_id,
    email,
    display_name
  )
  values (
    v_auth_user_id,
    v_email,
    v_display_name
  )
  on conflict (auth_user_id) do update
    set email = excluded.email,
        display_name = excluded.display_name
    where public.profiles.email is distinct from excluded.email
       or public.profiles.display_name is distinct from excluded.display_name
  returning *
  into v_profile;

  -- The conditional upsert WHERE can make RETURNING * produce no row on no-op repeat sign-ins.
  -- This branch reloads the existing row to preserve idempotent sign-in behavior.
  if v_profile.id is null then
    select *
    into v_profile
    from public.profiles
    where auth_user_id = v_auth_user_id;
  end if;

  return v_profile;
end;
$$;

revoke all on function public.ensure_profile(text, text) from public;
revoke all on function public.ensure_profile(text, text) from anon;
revoke all on function public.ensure_profile(text, text) from service_role;
revoke all on function public.ensure_profile(text, text) from mcp_session_executor;
grant execute on function public.ensure_profile(text, text) to authenticated;
