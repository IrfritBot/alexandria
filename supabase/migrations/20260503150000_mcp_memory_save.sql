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
security invoker
set search_path = public, pg_temp
as $$
declare
  v_memory_id uuid;
  v_metadata jsonb;
  v_tags jsonb := coalesce(p_tags, '[]'::jsonb);
  v_tag_name text;
  v_workspace_tag_id uuid;
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

  if exists (
    select 1
    from jsonb_array_elements_text(v_tags) as tag(name)
    where length(tag.name) = 0
      or tag.name !~ '^[a-z0-9:](?:[a-z0-9:/-]*[a-z0-9:])?$'
      or tag.name ~ '--'
  ) then
    raise exception 'invalid_input:tags' using errcode = '22023';
  end if;

  perform public.set_mcp_session(p_workspace_id, p_mcp_key_id);

  if public.has_active_mcp_session(p_workspace_id) is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.workspaces w
    where w.id = p_workspace_id
  ) then
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

  for v_tag_name in
    select distinct tag.name
    from jsonb_array_elements_text(v_tags) as tag(name)
    order by tag.name
  loop
    v_workspace_tag_id := null;

    insert into public.workspace_tags as wt (
      workspace_id,
      name,
      curated,
      created_by_profile_id
    )
    values (
      p_workspace_id,
      v_tag_name,
      false,
      null
    )
    on conflict (workspace_id, name) do nothing
    returning wt.id into v_workspace_tag_id;

    if v_workspace_tag_id is null then
      select wt.id
      into v_workspace_tag_id
      from public.workspace_tags wt
      where wt.workspace_id = p_workspace_id
        and wt.name = v_tag_name
        and wt.deleted_at is null;
    end if;

    if v_workspace_tag_id is null then
      raise exception 'invalid_input:tags' using errcode = '22023';
    end if;

    insert into public.memory_tags (
      workspace_id,
      memory_id,
      workspace_tag_id,
      created_by_profile_id
    )
    values (
      p_workspace_id,
      v_memory_id,
      v_workspace_tag_id,
      null
    )
    on conflict (workspace_id, memory_id, workspace_tag_id)
      where deleted_at is null
    do nothing;
  end loop;

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

do $$
begin
  if exists (
    select 1
    from pg_roles
    where rolname = 'authenticator'
  ) then
    execute 'grant mcp_session_executor to authenticator';
  end if;
end;
$$;

create policy memory_revisions_insert_mcp_session
  on public.memory_revisions
  for insert
  to mcp_session_executor
  with check (
    public.has_active_mcp_session(workspace_id)
    and author_profile_id is null
    and superseded_by_memory_id is null
    and revision_number = 1
    and kind = 'unknown'
    and kind_confidence is null
    and status = 'processing'
    and processing_tier = 'basic'
    and processed_at is null
    and deleted_at is null
  );

create policy workspace_tags_insert_mcp_session
  on public.workspace_tags
  for insert
  to mcp_session_executor
  with check (
    public.has_active_mcp_session(workspace_id)
    and name = lower(name)
    and name ~ '^[a-z0-9:](?:[a-z0-9:/-]*[a-z0-9:])?$'
    and name !~ '--'
    and display_name is null
    and description is null
    and parent_workspace_tag_id is null
    and curated = false
    and created_by_profile_id is null
    and deleted_at is null
  );

create policy memory_tags_insert_mcp_session
  on public.memory_tags
  for insert
  to mcp_session_executor
  with check (
    public.has_active_mcp_session(workspace_id)
    and created_by_profile_id is null
    and deleted_at is null
  );

create policy audit_log_memory_insert_mcp_session
  on public.audit_log_memory
  for insert
  to mcp_session_executor
  with check (
    public.has_active_mcp_session(workspace_id)
    and actor_type = 'mcp_key'
    and actor_profile_id is null
    and actor_mcp_key_id = nullif(current_setting('app.current_mcp_key_id', true), '')::uuid
    and action = 'memory_saved'
    and target_memory_id is not null
    and target_conflict_id is null
    and target_workspace_tag_id is null
  );

create policy usage_events_insert_mcp_session
  on public.usage_events
  for insert
  to mcp_session_executor
  with check (
    public.has_active_mcp_session(workspace_id)
    and actor_profile_id is null
    and actor_mcp_key_id = nullif(current_setting('app.current_mcp_key_id', true), '')::uuid
    and event_type = 'memory_save_requested'
    and processing_tier = 'basic'
  );

grant insert on
  public.memory_revisions,
  public.workspace_tags,
  public.memory_tags,
  public.audit_log_memory,
  public.usage_events
to mcp_session_executor;

revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from public;
revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from anon;
revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from authenticated;
revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from service_role;
grant execute on function public.save_mcp_memory(uuid, uuid, text, jsonb) to mcp_session_executor;
