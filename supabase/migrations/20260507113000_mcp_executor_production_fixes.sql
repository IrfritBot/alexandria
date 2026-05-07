-- Production hardening for MCP executor path.
--
-- The MCP executor role intentionally has no usage on the Supabase `auth` schema.
-- Keep the memory write trigger on the MCP branch before any `auth.role()` calls,
-- otherwise PostgREST-backed MCP inserts fail with `permission denied for schema auth`.
-- Also pin PL/pgSQL column/variable conflict behavior in `save_mcp_memory`; its
-- `returns table (memory_id, status)` output variables otherwise conflict with
-- `memory_tags.memory_id` in the partial upsert target on remote Postgres.

create or replace function public.enforce_memories_user_write_contract()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor_kind text := current_setting('app.actor_kind', true);
  v_is_service_context boolean := false;
  v_is_authenticated_admin boolean := false;
begin
  if v_actor_kind = 'mcp_key' and tg_op in ('UPDATE', 'DELETE') then
    raise exception 'MCP sessions cannot update or delete memories';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_actor_kind = 'mcp_key' then
      if public.has_active_mcp_session(new.workspace_id) is not true then
        raise exception 'MCP memory inserts require an active MCP session';
      end if;

      if new.author_profile_id is not null then
        raise exception 'MCP memory inserts cannot set author_profile_id';
      end if;

      if not public.is_raw_memory_insert(
        new.kind,
        new.kind_confidence,
        new.status,
        new.processing_tier,
        new.embedding,
        new.superseded_by_memory_id,
        new.processed_at,
        new.deleted_at
      ) then
        raise exception 'Memory inserts must use the raw pre-processing shape';
      end if;

      return new;
    end if;

    v_is_service_context :=
      auth.role() = 'service_role'
      or current_user in ('service_role', 'postgres', 'supabase_admin');

    if v_is_service_context then
      return new;
    end if;

    if not public.is_raw_memory_insert(
      new.kind,
      new.kind_confidence,
      new.status,
      new.processing_tier,
      new.embedding,
      new.superseded_by_memory_id,
      new.processed_at,
      new.deleted_at
    ) then
      raise exception 'Memory inserts must use the raw pre-processing shape';
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_is_service_context :=
      v_actor_kind is distinct from 'mcp_key'
      and (
        auth.role() = 'service_role'
        or current_user in ('service_role', 'postgres', 'supabase_admin')
      );

    if v_is_service_context then
      return new;
    end if;

    v_is_authenticated_admin :=
      v_actor_kind is distinct from 'mcp_key'
      and auth.role() = 'authenticated'
      and public.is_workspace_admin(old.workspace_id);

    if new.id is distinct from old.id
      or new.author_profile_id is distinct from old.author_profile_id
      or new.superseded_by_memory_id is distinct from old.superseded_by_memory_id
      or (
        not v_is_authenticated_admin
        and new.kind is distinct from old.kind
      )
      or (
        not v_is_authenticated_admin
        and new.kind_confidence is distinct from old.kind_confidence
      )
      or new.status is distinct from old.status
      or new.processing_tier is distinct from old.processing_tier
      or new.embedding::text is distinct from old.embedding::text
      or new.processed_at is distinct from old.processed_at
      or new.created_at is distinct from old.created_at
      or (
        not v_is_authenticated_admin
        and new.deleted_at is distinct from old.deleted_at
      ) then
      raise exception 'System-managed memory fields cannot be changed through this update path';
    end if;
  end if;

  return new;
end;
$$;

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
#variable_conflict use_column
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
