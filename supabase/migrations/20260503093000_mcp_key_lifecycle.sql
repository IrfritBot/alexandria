-- ALEX-003: MCP key lifecycle and verification RPCs.

create or replace function public.issue_mcp_key(
  p_workspace_id uuid,
  p_name text,
  p_key_prefix text,
  p_presented_key text
)
returns table (
  id uuid,
  workspace_id uuid,
  name text,
  key_prefix text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_actor_profile_id uuid;
  v_auth_user_id uuid := auth.uid();
  v_mcp_key_id uuid;
begin
  if v_auth_user_id is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_workspace_id is null then
    raise exception 'invalid_input:workspaceId' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'invalid_input:name' using errcode = '22023';
  end if;

  if p_key_prefix is null
    or p_presented_key is null
    or p_key_prefix !~ '^[a-f0-9]{8}$'
    or p_presented_key !~ ('^alex_' || p_key_prefix || '_[a-f0-9]{32}$') then
    raise exception 'invalid_input:key' using errcode = '22023';
  end if;

  select p.id
  into v_actor_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
    and p.deleted_at is null;

  if v_actor_profile_id is null then
    raise exception 'missing_profile';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.profile_id = v_actor_profile_id
      and wm.role = 'admin'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.mcp_keys as mk (
    workspace_id,
    name,
    key_prefix,
    key_hash,
    created_by_profile_id
  )
  values (
    p_workspace_id,
    btrim(p_name),
    p_key_prefix,
    extensions.crypt(p_presented_key, extensions.gen_salt('bf', 12)),
    v_actor_profile_id
  )
  returning mk.id into v_mcp_key_id;

  insert into public.audit_log_workspace (
    workspace_id,
    actor_type,
    actor_profile_id,
    action,
    target_mcp_key_id
  )
  values (
    p_workspace_id,
    'profile',
    v_actor_profile_id,
    'mcp_key_issued',
    v_mcp_key_id
  );

  return query
  select mk.id, mk.workspace_id, mk.name, mk.key_prefix, mk.created_at
  from public.mcp_keys mk
  where mk.id = v_mcp_key_id;
end;
$$;

revoke all on function public.issue_mcp_key(uuid, text, text, text) from public;
revoke all on function public.issue_mcp_key(uuid, text, text, text) from anon;
revoke all on function public.issue_mcp_key(uuid, text, text, text) from service_role;
revoke all on function public.issue_mcp_key(uuid, text, text, text) from mcp_session_executor;
grant execute on function public.issue_mcp_key(uuid, text, text, text) to authenticated;

create or replace function public.revoke_mcp_key(
  p_workspace_id uuid,
  p_mcp_key_id uuid
)
returns table (
  id uuid,
  workspace_id uuid,
  name text,
  key_prefix text,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_profile_id uuid;
  v_auth_user_id uuid := auth.uid();
  v_existing_revoked_at timestamptz;
begin
  if v_auth_user_id is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_workspace_id is null or p_mcp_key_id is null then
    raise exception 'invalid_input:key' using errcode = '22023';
  end if;

  select p.id
  into v_actor_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
    and p.deleted_at is null;

  if v_actor_profile_id is null then
    raise exception 'missing_profile';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.profile_id = v_actor_profile_id
      and wm.role = 'admin'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select mk.revoked_at
  into v_existing_revoked_at
  from public.mcp_keys mk
  where mk.workspace_id = p_workspace_id
    and mk.id = p_mcp_key_id;

  if not found then
    raise exception 'mcp_key_not_found' using errcode = 'P0002';
  end if;

  if v_existing_revoked_at is null then
    update public.mcp_keys mk
    set revoked_at = now(),
      revoked_by_profile_id = v_actor_profile_id
    where mk.workspace_id = p_workspace_id
      and mk.id = p_mcp_key_id;

    insert into public.audit_log_workspace (
      workspace_id,
      actor_type,
      actor_profile_id,
      action,
      target_mcp_key_id
    )
    values (
      p_workspace_id,
      'profile',
      v_actor_profile_id,
      'mcp_key_revoked',
      p_mcp_key_id
    );
  end if;

  return query
  select mk.id, mk.workspace_id, mk.name, mk.key_prefix, mk.revoked_at
  from public.mcp_keys mk
  where mk.workspace_id = p_workspace_id
    and mk.id = p_mcp_key_id;
end;
$$;

revoke all on function public.revoke_mcp_key(uuid, uuid) from public;
revoke all on function public.revoke_mcp_key(uuid, uuid) from anon;
revoke all on function public.revoke_mcp_key(uuid, uuid) from service_role;
revoke all on function public.revoke_mcp_key(uuid, uuid) from mcp_session_executor;
grant execute on function public.revoke_mcp_key(uuid, uuid) to authenticated;

create or replace function public.verify_mcp_api_key(
  p_key_prefix text,
  p_presented_key text
)
returns table (
  id uuid,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_key_prefix is null
    or p_presented_key is null
    or p_key_prefix !~ '^[a-f0-9]{8}$'
    or p_presented_key !~ ('^alex_' || p_key_prefix || '_[a-f0-9]{32}$') then
    return;
  end if;

  return query
  update public.mcp_keys mk
  set last_used_at = now()
  where mk.key_prefix = p_key_prefix
    and mk.revoked_at is null
    and mk.key_hash = extensions.crypt(p_presented_key, mk.key_hash)
  returning mk.id, mk.workspace_id;
end;
$$;

revoke all on function public.verify_mcp_api_key(text, text) from public;
revoke all on function public.verify_mcp_api_key(text, text) from anon;
revoke all on function public.verify_mcp_api_key(text, text) from authenticated;
revoke all on function public.verify_mcp_api_key(text, text) from mcp_session_executor;
grant execute on function public.verify_mcp_api_key(text, text) to service_role;
