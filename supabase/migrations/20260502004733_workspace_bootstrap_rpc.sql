-- ALEX-002: atomic workspace creation with creator admin membership.

create or replace function public.create_workspace_with_admin(
  p_name text,
  p_slug text,
  p_context_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_name text := btrim(p_name);
  v_slug text := btrim(p_slug);
  v_context_description text := btrim(p_context_description);
  v_workspace_id uuid;
begin
  if v_auth_user_id is null then
    raise exception 'unauthenticated'
      using errcode = '28000';
  end if;

  select id
  into v_caller_profile_id
  from public.profiles
  where auth_user_id = v_auth_user_id
    and deleted_at is null;

  if v_caller_profile_id is null then
    raise exception 'missing_profile'
      using errcode = 'P0001';
  end if;

  if v_name is null or length(v_name) = 0 then
    raise exception 'invalid_input:name'
      using errcode = '22023';
  end if;

  if v_slug is null
    or v_slug <> lower(v_slug)
    or length(v_slug) < 3
    or length(v_slug) > 63
    or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid_input:slug'
      using errcode = '22023';
  end if;

  if v_context_description is null
    or length(v_context_description) < 30 then
    raise exception 'invalid_input:contextDescription'
      using errcode = '22023';
  end if;

  begin
    insert into public.workspaces (
      name,
      slug,
      context_description,
      tier,
      created_by_profile_id
    )
    values (
      v_name,
      v_slug,
      v_context_description,
      'basic',
      v_caller_profile_id
    )
    returning id
    into v_workspace_id;

    insert into public.workspace_members (
      workspace_id,
      profile_id,
      role
    )
    values (
      v_workspace_id,
      v_caller_profile_id,
      'admin'
    );

    insert into public.audit_log_workspace (
      workspace_id,
      actor_type,
      actor_profile_id,
      action,
      target_profile_id,
      metadata
    )
    values (
      v_workspace_id,
      'profile',
      v_caller_profile_id,
      'workspace_created',
      v_caller_profile_id,
      jsonb_build_object('slug', v_slug)
    );
  exception
    when unique_violation then
      raise exception 'workspace slug already exists'
        using errcode = '23505';
  end;

  return v_workspace_id;
end;
$$;

revoke all on function public.create_workspace_with_admin(text, text, text) from public;
revoke all on function public.create_workspace_with_admin(text, text, text) from anon;
revoke all on function public.create_workspace_with_admin(text, text, text) from service_role;
revoke all on function public.create_workspace_with_admin(text, text, text) from mcp_session_executor;
grant execute on function public.create_workspace_with_admin(text, text, text) to authenticated;
