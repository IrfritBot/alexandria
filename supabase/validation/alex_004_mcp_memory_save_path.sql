-- ALEX-004 MCP memory_save role/session integration checks.
--
-- Run after migrations:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/validation/alex_004_mcp_memory_save_path.sql

do $$
declare
  v_is_security_definer boolean;
begin
  select p.prosecdef
  into v_is_security_definer
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid = 'public.save_mcp_memory(uuid, uuid, text, jsonb)'::regprocedure;

  if v_is_security_definer is distinct from false then
    raise exception 'save_mcp_memory must be SECURITY INVOKER so mcp_session_executor RLS applies';
  end if;

  if exists (
    select 1
    from pg_roles
    where rolname = 'service_role'
  ) and has_function_privilege(
      'service_role',
      'public.save_mcp_memory(uuid, uuid, text, jsonb)',
      'EXECUTE'
    ) then
    raise exception 'service_role must not execute save_mcp_memory tenant writes';
  end if;

  if not has_function_privilege(
    'mcp_session_executor',
    'public.save_mcp_memory(uuid, uuid, text, jsonb)',
    'EXECUTE'
  ) then
    raise exception 'mcp_session_executor must execute save_mcp_memory';
  end if;

  if exists (
    select 1
    from pg_roles
    where rolname = 'authenticator'
  ) and not pg_has_role('authenticator', 'mcp_session_executor', 'member') then
    raise exception 'authenticator must be able to assume mcp_session_executor for PostgREST requests';
  end if;

  if exists (
    select 1
    from pg_roles
    where rolname = 'mcp_session_executor'
      and rolbypassrls
  ) then
    raise exception 'mcp_session_executor must not BYPASSRLS';
  end if;
end;
$$;

delete from public.memory_tags
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.audit_log_memory
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.usage_events
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.memory_revisions
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.workspace_tags
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.memories
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.mcp_keys
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.workspaces
where id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

insert into public.workspaces (
  id,
  name,
  slug,
  context_description,
  tier
)
values
  (
    '10000000-0000-4000-8000-000000000001'::uuid,
    'ALEX 004 Workspace One',
    'alex-004-workspace-one',
    'Workspace one exists only for MCP memory_save integration validation.',
    'basic'
  ),
  (
    '10000000-0000-4000-8000-000000000002'::uuid,
    'ALEX 004 Workspace Two',
    'alex-004-workspace-two',
    'Workspace two exists only for cross-workspace MCP validation checks.',
    'basic'
  );

insert into public.mcp_keys (
  id,
  workspace_id,
  name,
  key_prefix,
  key_hash,
  revoked_at
)
values
  (
    '20000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000001'::uuid,
    'Workspace one active test key',
    'abc00101',
    extensions.crypt(
      'alex_abc00101_11111111111111111111111111111111',
      extensions.gen_salt('bf', 4)
    ),
    null
  ),
  (
    '20000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000001'::uuid,
    'Workspace one revoked test key',
    'abc00102',
    extensions.crypt(
      'alex_abc00102_22222222222222222222222222222222',
      extensions.gen_salt('bf', 4)
    ),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000003'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid,
    'Workspace two active test key',
    'abc00103',
    extensions.crypt(
      'alex_abc00103_33333333333333333333333333333333',
      extensions.gen_salt('bf', 4)
    ),
    null
  );

do $$
declare
  v_verified_key_id uuid;
  v_verified_workspace_id uuid;
begin
  select id, workspace_id
  into v_verified_key_id, v_verified_workspace_id
  from public.verify_mcp_api_key(
    'abc00101',
    'alex_abc00101_11111111111111111111111111111111'
  );

  if v_verified_key_id <> '20000000-0000-4000-8000-000000000001'::uuid
    or v_verified_workspace_id <> '10000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'valid MCP key did not verify to its workspace';
  end if;

  if exists (
    select 1
    from public.verify_mcp_api_key(
      'abc00102',
      'alex_abc00102_22222222222222222222222222222222'
    )
  ) then
    raise exception 'revoked MCP key must not verify';
  end if;

  if exists (
    select 1
    from public.verify_mcp_api_key(
      'abc00101',
      'alex_abc00101_99999999999999999999999999999999'
    )
  ) then
    raise exception 'invalid MCP key secret must not verify';
  end if;
end;
$$;

begin;
set local role mcp_session_executor;
select public.save_mcp_memory(
  '10000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  'Remember that workspace one uses Friday deploy freezes.',
  '["policy","release-notes","policy"]'::jsonb
);
commit;

do $$
declare
  v_memory_id uuid;
begin
  select id
  into v_memory_id
  from public.memories
  where workspace_id = '10000000-0000-4000-8000-000000000001'::uuid
    and content = 'Remember that workspace one uses Friday deploy freezes.';

  if v_memory_id is null then
    raise exception 'memory_save did not persist the memory row';
  end if;

  if not exists (
    select 1
    from public.memory_revisions mr
    where mr.workspace_id = '10000000-0000-4000-8000-000000000001'::uuid
      and mr.memory_id = v_memory_id
      and mr.revision_number = 1
      and mr.status = 'processing'
  ) then
    raise exception 'memory_save did not persist the initial revision';
  end if;

  if not exists (
    select 1
    from public.workspace_tags wt
    where wt.workspace_id = '10000000-0000-4000-8000-000000000001'::uuid
      and wt.name = 'policy'
      and wt.curated = false
  ) or not exists (
    select 1
    from public.workspace_tags wt
    where wt.workspace_id = '10000000-0000-4000-8000-000000000001'::uuid
      and wt.name = 'release-notes'
      and wt.curated = false
  ) then
    raise exception 'memory_save did not upsert normalized workspace tags';
  end if;

  if (
    select count(*)
    from public.memory_tags mt
    join public.workspace_tags wt
      on wt.workspace_id = mt.workspace_id
      and wt.id = mt.workspace_tag_id
    where mt.workspace_id = '10000000-0000-4000-8000-000000000001'::uuid
      and mt.memory_id = v_memory_id
      and wt.name in ('policy', 'release-notes')
  ) <> 2 then
    raise exception 'memory_save did not persist normalized memory_tags rows';
  end if;

  if not exists (
    select 1
    from public.audit_log_memory alm
    where alm.workspace_id = '10000000-0000-4000-8000-000000000001'::uuid
      and alm.actor_mcp_key_id = '20000000-0000-4000-8000-000000000001'::uuid
      and alm.action = 'memory_saved'
      and alm.target_memory_id = v_memory_id
  ) then
    raise exception 'memory_save did not persist the memory audit row';
  end if;

  if not exists (
    select 1
    from public.usage_events ue
    where ue.workspace_id = '10000000-0000-4000-8000-000000000001'::uuid
      and ue.actor_mcp_key_id = '20000000-0000-4000-8000-000000000001'::uuid
      and ue.event_type = 'memory_save_requested'
  ) then
    raise exception 'memory_save did not persist the usage event';
  end if;
end;
$$;

begin;
set local role mcp_session_executor;
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform memory_id
    from public.save_mcp_memory(
      '10000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid,
      'Revoked key write should fail.',
      '[]'::jsonb
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
    when raise_exception then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'revoked MCP key save must be rejected';
  end if;
end;
$$;
rollback;

begin;
set local role mcp_session_executor;
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform memory_id
    from public.save_mcp_memory(
      '10000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000009999'::uuid,
      'Unknown key write should fail.',
      '[]'::jsonb
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
    when raise_exception then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'unknown MCP key save must be rejected';
  end if;
end;
$$;
rollback;

begin;
set local role mcp_session_executor;
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform memory_id
    from public.save_mcp_memory(
      '10000000-0000-4000-8000-000000000002'::uuid,
      '20000000-0000-4000-8000-000000000001'::uuid,
      'Cross-workspace write should fail.',
      '[]'::jsonb
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
    when raise_exception then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'cross-workspace MCP key save must be rejected';
  end if;
end;
$$;
rollback;

begin;
set local role mcp_session_executor;
do $$
declare
  v_rejected boolean := false;
begin
  perform public.set_mcp_session(
    '10000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000001'::uuid
  );

  begin
    insert into public.memories (
      workspace_id,
      author_profile_id,
      kind,
      status,
      processing_tier,
      content
    )
    values (
      '10000000-0000-4000-8000-000000000002'::uuid,
      null,
      'unknown',
      'processing',
      'basic',
      'Direct cross-workspace RLS write should fail.'
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
    when raise_exception then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'direct cross-workspace insert must be denied by RLS';
  end if;
end;
$$;
rollback;

begin;
set local role mcp_session_executor;
select public.set_mcp_session(
  '10000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid
);
do $$
begin
  if current_setting('app.current_workspace_id', true)
    <> '10000000-0000-4000-8000-000000000001' then
    raise exception 'workspace session setting was not set inside transaction';
  end if;

  if current_setting('app.current_mcp_key_id', true)
    <> '20000000-0000-4000-8000-000000000001' then
    raise exception 'MCP key session setting was not set inside transaction';
  end if;

  if current_setting('app.actor_kind', true) <> 'mcp_key' then
    raise exception 'actor session setting was not set inside transaction';
  end if;
end;
$$;
commit;

reset role;

do $$
begin
  if nullif(current_setting('app.current_workspace_id', true), '') is not null
    or nullif(current_setting('app.current_mcp_key_id', true), '') is not null
    or nullif(current_setting('app.actor_kind', true), '') is not null then
    raise exception 'MCP session settings must clear after transaction commit';
  end if;
end;
$$;

delete from public.memory_tags
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.audit_log_memory
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.usage_events
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.memory_revisions
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.workspace_tags
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.memories
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.mcp_keys
where workspace_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

delete from public.workspaces
where id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);
