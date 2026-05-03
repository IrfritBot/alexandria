-- ALEX-004: MCP memory_save first-write path.

create or replace function public.save_mcp_memory(
  p_workspace_id uuid,
  p_mcp_key_id uuid,
  p_content text,
  p_tags jsonb default '[]'::jsonb
)
returns table (
  memory_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_memory_id uuid;
  v_metadata jsonb;
  v_tags jsonb := coalesce(p_tags, '[]'::jsonb);
begin
  if p_workspace_id is null or p_mcp_key_id is null then
    raise exception 'invalid_input:session' using errcode = '22023';
  end if;

  if p_content is null
    or length(btrim(p_content)) = 0
    or length(btrim(p_content)) > 8192 then
    raise exception 'invalid_input:content' using errcode = '22023';
  end if;

  if jsonb_typeof(v_tags) is distinct from 'array' then
    raise exception 'invalid_input:tags' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_tags) as tag(value)
    where jsonb_typeof(tag.value) is distinct from 'string'
  ) then
    raise exception 'invalid_input:tags' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.mcp_keys mk
    where mk.workspace_id = p_workspace_id
      and mk.id = p_mcp_key_id
      and mk.revoked_at is null
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform public.set_mcp_session(p_workspace_id, p_mcp_key_id);

  if public.has_active_mcp_session(p_workspace_id) is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_metadata := jsonb_build_object(
    'source',
    'mcp',
    'tags',
    v_tags
  );

  insert into public.memories as m (
    workspace_id,
    author_profile_id,
    kind,
    status,
    processing_tier,
    content,
    metadata
  )
  values (
    p_workspace_id,
    null,
    'unknown',
    'processing',
    'basic',
    btrim(p_content),
    v_metadata
  )
  returning m.id into v_memory_id;

  insert into public.memory_revisions (
    workspace_id,
    memory_id,
    author_profile_id,
    revision_number,
    kind,
    status,
    processing_tier,
    content,
    metadata
  )
  values (
    p_workspace_id,
    v_memory_id,
    null,
    1,
    'unknown',
    'processing',
    'basic',
    btrim(p_content),
    v_metadata
  );

  insert into public.audit_log_memory (
    workspace_id,
    actor_type,
    actor_mcp_key_id,
    action,
    target_memory_id,
    metadata
  )
  values (
    p_workspace_id,
    'mcp_key',
    p_mcp_key_id,
    'memory_saved',
    v_memory_id,
    jsonb_build_object(
      'source',
      'mcp',
      'tags',
      v_tags
    )
  );

  insert into public.usage_events (
    workspace_id,
    actor_mcp_key_id,
    event_type,
    processing_tier
  )
  values (
    p_workspace_id,
    p_mcp_key_id,
    'memory_save_requested',
    'basic'
  );

  return query select v_memory_id, 'processing'::text;
end;
$$;

revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from public;
revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from anon;
revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from authenticated;
revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from mcp_session_executor;
grant execute on function public.save_mcp_memory(uuid, uuid, text, jsonb) to service_role;
