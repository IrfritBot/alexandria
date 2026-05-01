-- ALEX-001 DB-layer quality checks.
-- Run after applying migrations, for example:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/validation/alex_001_quality.sql

do $$
declare
  bad_policies text[];
  missing_admin_select text[];
  mcp_select_policies text[];
begin
  with admin_tables(table_name) as (
    values
      ('conflicts'),
      ('audit_log_memory'),
      ('workspace_invites'),
      ('mcp_keys'),
      ('audit_log_workspace'),
      ('usage_events')
  ),
  policy_exprs as (
    select
      c.relname,
      p.polname,
      regexp_replace(
        coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
        '[[:space:]]+',
        ' ',
        'g'
      ) as expression
    from admin_tables admin_table
    join pg_namespace n
      on n.nspname = 'public'
    join pg_class c
      on c.relnamespace = n.oid
      and c.relname = admin_table.table_name
    join pg_policy p
      on p.polrelid = c.oid
    where p.polcmd in ('r', '*')
  )
  select array_agg(
    format('%s.%s: %s', relname, polname, expression)
    order by relname, polname
  )
  into bad_policies
  from policy_exprs
  where expression not in (
    'is_workspace_admin(workspace_id)',
    'public.is_workspace_admin(workspace_id)'
  );

  if coalesce(array_length(bad_policies, 1), 0) > 0 then
    raise exception 'governance/admin-owned tables have non-admin SELECT policies: %', bad_policies;
  end if;

  with admin_tables(table_name) as (
    values
      ('conflicts'),
      ('audit_log_memory'),
      ('workspace_invites'),
      ('mcp_keys'),
      ('audit_log_workspace'),
      ('usage_events')
  )
  select array_agg(admin_table.table_name order by admin_table.table_name)
  into missing_admin_select
  from admin_tables admin_table
  where not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_policy p
      on p.polrelid = c.oid
    where n.nspname = 'public'
      and c.relname = admin_table.table_name
      and p.polcmd in ('r', '*')
      and coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%is_workspace_admin%'
  );

  if coalesce(array_length(missing_admin_select, 1), 0) > 0 then
    raise exception 'governance/admin-owned tables are missing admin SELECT policies: %', missing_admin_select;
  end if;

  with admin_tables(table_name) as (
    values
      ('conflicts'),
      ('audit_log_memory'),
      ('workspace_invites'),
      ('mcp_keys'),
      ('audit_log_workspace'),
      ('usage_events')
  ),
  policy_exprs as (
    select
      c.relname,
      p.polname,
      lower(regexp_replace(
        coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
        '[[:space:]]+',
        ' ',
        'g'
      )) as expression
    from admin_tables admin_table
    join pg_namespace n
      on n.nspname = 'public'
    join pg_class c
      on c.relnamespace = n.oid
      and c.relname = admin_table.table_name
    join pg_policy p
      on p.polrelid = c.oid
    where p.polcmd in ('r', '*')
  )
  select array_agg(
    format('%s.%s: %s', relname, polname, expression)
    order by relname, polname
  )
  into mcp_select_policies
  from policy_exprs
  where lower(polname) like '%mcp_session%'
    or expression like '%has_active_mcp_session%';

  if coalesce(array_length(mcp_select_policies, 1), 0) > 0 then
    raise exception 'governance/admin-owned tables must not expose MCP SELECT policies: %',
      mcp_select_policies;
  end if;
end;
$$;

do $$
declare
  is_security_definer boolean;
  function_config text[];
  public_can_execute boolean;
  mcp_role_exists boolean;
  mcp_role_has_bypassrls boolean;
  mcp_role_is_superuser boolean;
  mcp_role_can_login boolean;
  mcp_role_can_execute boolean;
  service_role_exists boolean;
  service_role_can_execute boolean;
  broad_execute_roles text[];
begin
  select
    r.rolname is not null,
    coalesce(r.rolbypassrls, true),
    coalesce(r.rolsuper, true),
    coalesce(r.rolcanlogin, true)
  into
    mcp_role_exists,
    mcp_role_has_bypassrls,
    mcp_role_is_superuser,
    mcp_role_can_login
  from (select 1) s
  left join pg_roles r
    on r.rolname = 'mcp_session_executor';

  if mcp_role_exists is not true then
    raise exception 'mcp_session_executor role is missing';
  end if;

  if mcp_role_has_bypassrls or mcp_role_is_superuser then
    raise exception 'mcp_session_executor must be a non-superuser, non-BYPASSRLS role';
  end if;

  if mcp_role_can_login then
    raise exception 'mcp_session_executor must be NOLOGIN so it is only an executor role';
  end if;

  select p.prosecdef, p.proconfig
  into is_security_definer, function_config
  from pg_proc p
  where p.oid = 'public.set_mcp_session(uuid, uuid)'::regprocedure;

  if is_security_definer is not true then
    raise exception 'set_mcp_session must be SECURITY DEFINER for trusted executor use';
  end if;

  if not exists (
    select 1
    from unnest(coalesce(function_config, array[]::text[])) as function_setting(setting)
    where regexp_replace(function_setting.setting, '[[:space:]]+', '', 'g') =
      'search_path=public,pg_temp'
  ) then
    raise exception 'set_mcp_session must use safe search_path public, pg_temp';
  end if;

  with fn as (
    select p.proacl, p.proowner
    from pg_proc p
    where p.oid = 'public.set_mcp_session(uuid, uuid)'::regprocedure
  ),
  acl as (
    select acl_entry.grantee, acl_entry.privilege_type
    from fn
    cross join lateral aclexplode(
      coalesce(fn.proacl, acldefault('f', fn.proowner))
    ) acl_entry
  )
  select exists (
    select 1
    from acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  )
  into public_can_execute;

  if public_can_execute then
    raise exception 'set_mcp_session must not be executable by PUBLIC';
  end if;

  select has_function_privilege(
    'mcp_session_executor',
    'public.set_mcp_session(uuid, uuid)',
    'EXECUTE'
  )
  into mcp_role_can_execute;

  if mcp_role_can_execute is not true then
    raise exception 'set_mcp_session must be executable by mcp_session_executor';
  end if;

  select exists (
    select 1
    from pg_roles
    where rolname = 'service_role'
  )
  into service_role_exists;

  if service_role_exists then
    select has_function_privilege(
      'service_role',
      'public.set_mcp_session(uuid, uuid)',
      'EXECUTE'
    )
    into service_role_can_execute;
  else
    service_role_can_execute := false;
  end if;

  if service_role_can_execute then
    raise exception 'set_mcp_session must not be executable by service_role because service_role bypasses RLS';
  end if;

  with fn as (
    select p.proacl, p.proowner
    from pg_proc p
    where p.oid = 'public.set_mcp_session(uuid, uuid)'::regprocedure
  ),
  acl as (
    select acl_entry.grantee, acl_entry.privilege_type
    from fn
    cross join lateral aclexplode(
      coalesce(fn.proacl, acldefault('f', fn.proowner))
    ) acl_entry
  )
  select array_agg(r.rolname order by r.rolname)
  into broad_execute_roles
  from acl
  join pg_roles r
    on r.oid = acl.grantee
  where r.rolname in ('anon', 'authenticated')
    and acl.privilege_type = 'EXECUTE';

  if coalesce(array_length(broad_execute_roles, 1), 0) > 0 then
    raise exception 'set_mcp_session must not be executable by broad client roles: %',
      broad_execute_roles;
  end if;
end;
$$;

do $$
declare
  missing_helpers text[];
  public_executable_helpers text[];
  missing_authenticated_helpers text[];
  forbidden_authenticated_helpers text[];
  missing_mcp_helpers text[];
  forbidden_mcp_helpers text[];
  forbidden_direct_helper_grants text[];
begin
  with expected_helpers(function_signature, authenticated_allowed, mcp_allowed) as (
    values
      ('public.has_workspace_membership(uuid)', true, false),
      ('public.has_shared_workspace_with_profile(uuid)', true, false),
      ('public.is_workspace_admin(uuid)', true, false),
      ('public.is_own_workspace_memory(uuid, uuid)', true, false),
      ('public.has_active_mcp_session(uuid)', false, true),
      (
        'public.is_raw_memory_insert(text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz)',
        true,
        true
      )
  ),
  helper_oids as (
    select
      expected_helpers.function_signature,
      expected_helpers.authenticated_allowed,
      expected_helpers.mcp_allowed,
      to_regprocedure(expected_helpers.function_signature) as function_oid
    from expected_helpers
  )
  select array_agg(function_signature order by function_signature)
  into missing_helpers
  from helper_oids
  where function_oid is null;

  if coalesce(array_length(missing_helpers, 1), 0) > 0 then
    raise exception 'RLS helper functions are missing: %', missing_helpers;
  end if;

  with expected_helpers(function_signature, authenticated_allowed, mcp_allowed) as (
    values
      ('public.has_workspace_membership(uuid)', true, false),
      ('public.has_shared_workspace_with_profile(uuid)', true, false),
      ('public.is_workspace_admin(uuid)', true, false),
      ('public.is_own_workspace_memory(uuid, uuid)', true, false),
      ('public.has_active_mcp_session(uuid)', false, true),
      (
        'public.is_raw_memory_insert(text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz)',
        true,
        true
      )
  ),
  helper_oids as (
    select
      expected_helpers.function_signature,
      expected_helpers.authenticated_allowed,
      expected_helpers.mcp_allowed,
      to_regprocedure(expected_helpers.function_signature) as function_oid
    from expected_helpers
  ),
  helper_acl as (
    select helper_oids.function_signature, acl_entry.grantee, acl_entry.privilege_type
    from helper_oids
    join pg_proc p
      on p.oid = helper_oids.function_oid
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl_entry
  )
  select array_agg(function_signature order by function_signature)
  into public_executable_helpers
  from helper_acl
  where grantee = 0
    and privilege_type = 'EXECUTE';

  if coalesce(array_length(public_executable_helpers, 1), 0) > 0 then
    raise exception 'RLS helper functions must not be executable by PUBLIC: %',
      public_executable_helpers;
  end if;

  with expected_helpers(function_signature, authenticated_allowed, mcp_allowed) as (
    values
      ('public.has_workspace_membership(uuid)', true, false),
      ('public.has_shared_workspace_with_profile(uuid)', true, false),
      ('public.is_workspace_admin(uuid)', true, false),
      ('public.is_own_workspace_memory(uuid, uuid)', true, false),
      ('public.has_active_mcp_session(uuid)', false, true),
      (
        'public.is_raw_memory_insert(text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz)',
        true,
        true
      )
  )
  select array_agg(function_signature order by function_signature)
  into missing_authenticated_helpers
  from expected_helpers
  where authenticated_allowed
    and not has_function_privilege('authenticated', function_signature, 'EXECUTE');

  if coalesce(array_length(missing_authenticated_helpers, 1), 0) > 0 then
    raise exception 'authenticated missing required RLS helper EXECUTE grants: %',
      missing_authenticated_helpers;
  end if;

  with expected_helpers(function_signature, authenticated_allowed, mcp_allowed) as (
    values
      ('public.has_workspace_membership(uuid)', true, false),
      ('public.has_shared_workspace_with_profile(uuid)', true, false),
      ('public.is_workspace_admin(uuid)', true, false),
      ('public.is_own_workspace_memory(uuid, uuid)', true, false),
      ('public.has_active_mcp_session(uuid)', false, true),
      (
        'public.is_raw_memory_insert(text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz)',
        true,
        true
      )
  )
  select array_agg(function_signature order by function_signature)
  into forbidden_authenticated_helpers
  from expected_helpers
  where not authenticated_allowed
    and has_function_privilege('authenticated', function_signature, 'EXECUTE');

  if coalesce(array_length(forbidden_authenticated_helpers, 1), 0) > 0 then
    raise exception 'authenticated must not execute MCP-only RLS helpers: %',
      forbidden_authenticated_helpers;
  end if;

  with expected_helpers(function_signature, authenticated_allowed, mcp_allowed) as (
    values
      ('public.has_workspace_membership(uuid)', true, false),
      ('public.has_shared_workspace_with_profile(uuid)', true, false),
      ('public.is_workspace_admin(uuid)', true, false),
      ('public.is_own_workspace_memory(uuid, uuid)', true, false),
      ('public.has_active_mcp_session(uuid)', false, true),
      (
        'public.is_raw_memory_insert(text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz)',
        true,
        true
      )
  )
  select array_agg(function_signature order by function_signature)
  into missing_mcp_helpers
  from expected_helpers
  where mcp_allowed
    and not has_function_privilege('mcp_session_executor', function_signature, 'EXECUTE');

  if coalesce(array_length(missing_mcp_helpers, 1), 0) > 0 then
    raise exception 'mcp_session_executor missing required RLS helper EXECUTE grants: %',
      missing_mcp_helpers;
  end if;

  with expected_helpers(function_signature, authenticated_allowed, mcp_allowed) as (
    values
      ('public.has_workspace_membership(uuid)', true, false),
      ('public.has_shared_workspace_with_profile(uuid)', true, false),
      ('public.is_workspace_admin(uuid)', true, false),
      ('public.is_own_workspace_memory(uuid, uuid)', true, false),
      ('public.has_active_mcp_session(uuid)', false, true),
      (
        'public.is_raw_memory_insert(text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz)',
        true,
        true
      )
  )
  select array_agg(function_signature order by function_signature)
  into forbidden_mcp_helpers
  from expected_helpers
  where not mcp_allowed
    and has_function_privilege('mcp_session_executor', function_signature, 'EXECUTE');

  if coalesce(array_length(forbidden_mcp_helpers, 1), 0) > 0 then
    raise exception 'mcp_session_executor must not execute web/user RLS helpers: %',
      forbidden_mcp_helpers;
  end if;

  with expected_helpers(function_signature, authenticated_allowed, mcp_allowed) as (
    values
      ('public.has_workspace_membership(uuid)', true, false),
      ('public.has_shared_workspace_with_profile(uuid)', true, false),
      ('public.is_workspace_admin(uuid)', true, false),
      ('public.is_own_workspace_memory(uuid, uuid)', true, false),
      ('public.has_active_mcp_session(uuid)', false, true),
      (
        'public.is_raw_memory_insert(text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz)',
        true,
        true
      )
  ),
  helper_oids as (
    select
      expected_helpers.function_signature,
      expected_helpers.authenticated_allowed,
      expected_helpers.mcp_allowed,
      to_regprocedure(expected_helpers.function_signature) as function_oid
    from expected_helpers
  ),
  helper_acl as (
    select
      helper_oids.function_signature,
      helper_oids.authenticated_allowed,
      helper_oids.mcp_allowed,
      acl_entry.grantee,
      p.proowner,
      r.rolname,
      acl_entry.privilege_type
    from helper_oids
    join pg_proc p
      on p.oid = helper_oids.function_oid
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl_entry
    join pg_roles r
      on r.oid = acl_entry.grantee
  )
  select array_agg(format('%s:%s', function_signature, rolname) order by function_signature, rolname)
  into forbidden_direct_helper_grants
  from helper_acl
  where privilege_type = 'EXECUTE'
    and grantee <> proowner
    and not (
      (rolname = 'authenticated' and authenticated_allowed)
      or (rolname = 'mcp_session_executor' and mcp_allowed)
    );

  if coalesce(array_length(forbidden_direct_helper_grants, 1), 0) > 0 then
    raise exception 'RLS helper functions have forbidden direct EXECUTE grants: %',
      forbidden_direct_helper_grants;
  end if;
end;
$$;

do $$
declare
  mistargeted_authenticated_policies text[];
begin
  with expected_authenticated_policies(table_name, policy_name) as (
    values
      ('profiles', 'profiles_select_own_auth_user'),
      ('profiles', 'profiles_select_shared_workspace_user_member'),
      ('workspace_members', 'workspace_members_select_user_workspace_member'),
      ('workspaces', 'workspaces_select_user_member'),
      ('mcp_keys', 'mcp_keys_select_user_admin'),
      ('memories', 'memories_select_user_member'),
      ('memory_revisions', 'memory_revisions_select_user_member'),
      ('conflicts', 'conflicts_select_user_admin'),
      ('workspace_tags', 'workspace_tags_select_user_member'),
      ('memory_tags', 'memory_tags_select_user_member'),
      ('audit_log_memory', 'audit_log_memory_select_user_admin'),
      ('audit_log_workspace', 'audit_log_workspace_select_user_admin'),
      ('usage_events', 'usage_events_select_user_admin'),
      ('workspace_invites', 'workspace_invites_select_user_admin'),
      ('memories', 'memories_insert_user_member'),
      ('memories', 'memories_update_user_admin'),
      ('mcp_keys', 'mcp_keys_insert_user_admin'),
      ('mcp_keys', 'mcp_keys_update_user_admin'),
      ('workspace_invites', 'workspace_invites_insert_user_admin'),
      ('workspace_invites', 'workspace_invites_update_user_admin'),
      ('conflicts', 'conflicts_update_user_admin'),
      ('workspaces', 'workspaces_update_user_admin'),
      ('workspace_members', 'workspace_members_insert_user_admin'),
      ('workspace_members', 'workspace_members_update_user_admin'),
      ('workspace_members', 'workspace_members_delete_user_admin')
  )
  select array_agg(
    format('%s.%s', expected_authenticated_policies.table_name, expected_authenticated_policies.policy_name)
    order by expected_authenticated_policies.table_name, expected_authenticated_policies.policy_name
  )
  into mistargeted_authenticated_policies
  from expected_authenticated_policies
  where not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_policy p
      on p.polrelid = c.oid
    join pg_roles r
      on r.rolname = 'authenticated'
    where n.nspname = 'public'
      and c.relname = expected_authenticated_policies.table_name
      and p.polname = expected_authenticated_policies.policy_name
      and r.oid = any(p.polroles)
      and 0::oid <> all(p.polroles)
  );

  if coalesce(array_length(mistargeted_authenticated_policies, 1), 0) > 0 then
    raise exception 'web/user RLS policies must target authenticated, not PUBLIC: %',
      mistargeted_authenticated_policies;
  end if;
end;
$$;

do $$
declare
  missing_mcp_select_grants text[];
  forbidden_mcp_select_grants text[];
  missing_mcp_insert_grant boolean;
  forbidden_mcp_mutation_grants text[];
  mistargeted_mcp_policies text[];
begin
  with allowed_select_tables(table_name) as (
    values
      ('workspaces'),
      ('workspace_members'),
      ('memories'),
      ('memory_revisions'),
      ('workspace_tags'),
      ('memory_tags')
  )
  select array_agg(table_name order by table_name)
  into missing_mcp_select_grants
  from allowed_select_tables
  where not has_table_privilege(
    'mcp_session_executor',
    format('public.%I', table_name),
    'SELECT'
  );

  if coalesce(array_length(missing_mcp_select_grants, 1), 0) > 0 then
    raise exception 'mcp_session_executor missing minimal MCP SELECT grants: %',
      missing_mcp_select_grants;
  end if;

  with all_tables(table_name) as (
    values
      ('profiles'),
      ('workspaces'),
      ('workspace_members'),
      ('mcp_keys'),
      ('memories'),
      ('memory_revisions'),
      ('conflicts'),
      ('workspace_tags'),
      ('memory_tags'),
      ('audit_log_memory'),
      ('audit_log_workspace'),
      ('usage_events'),
      ('workspace_invites')
  ),
  allowed_select_tables(table_name) as (
    values
      ('workspaces'),
      ('workspace_members'),
      ('memories'),
      ('memory_revisions'),
      ('workspace_tags'),
      ('memory_tags')
  )
  select array_agg(all_tables.table_name order by all_tables.table_name)
  into forbidden_mcp_select_grants
  from all_tables
  left join allowed_select_tables
    on allowed_select_tables.table_name = all_tables.table_name
  where allowed_select_tables.table_name is null
    and has_table_privilege(
      'mcp_session_executor',
      format('public.%I', all_tables.table_name),
      'SELECT'
    );

  if coalesce(array_length(forbidden_mcp_select_grants, 1), 0) > 0 then
    raise exception 'mcp_session_executor has forbidden SELECT grants: %',
      forbidden_mcp_select_grants;
  end if;

  select not has_table_privilege(
    'mcp_session_executor',
    'public.memories',
    'INSERT'
  )
  into missing_mcp_insert_grant;

  if missing_mcp_insert_grant then
    raise exception 'mcp_session_executor missing minimal MCP INSERT grant on memories';
  end if;

  with all_tables(table_name) as (
    values
      ('profiles'),
      ('workspaces'),
      ('workspace_members'),
      ('mcp_keys'),
      ('memories'),
      ('memory_revisions'),
      ('conflicts'),
      ('workspace_tags'),
      ('memory_tags'),
      ('audit_log_memory'),
      ('audit_log_workspace'),
      ('usage_events'),
      ('workspace_invites')
  ),
  privileges(privilege_type) as (
    values ('INSERT'), ('UPDATE'), ('DELETE')
  )
  select array_agg(
    format('%s:%s', all_tables.table_name, privileges.privilege_type)
    order by all_tables.table_name, privileges.privilege_type
  )
  into forbidden_mcp_mutation_grants
  from all_tables
  cross join privileges
  where not (
      all_tables.table_name = 'memories'
      and privileges.privilege_type = 'INSERT'
    )
    and has_table_privilege(
      'mcp_session_executor',
      format('public.%I', all_tables.table_name),
      privileges.privilege_type
    );

  if coalesce(array_length(forbidden_mcp_mutation_grants, 1), 0) > 0 then
    raise exception 'mcp_session_executor has forbidden mutation grants: %',
      forbidden_mcp_mutation_grants;
  end if;

  with expected_mcp_policies(table_name, policy_name) as (
    values
      ('workspaces', 'workspaces_select_mcp_session'),
      ('workspace_members', 'workspace_members_select_mcp_session'),
      ('memories', 'memories_select_mcp_session'),
      ('memory_revisions', 'memory_revisions_select_mcp_session'),
      ('workspace_tags', 'workspace_tags_select_mcp_session'),
      ('memory_tags', 'memory_tags_select_mcp_session'),
      ('memories', 'memories_insert_mcp_session')
  )
  select array_agg(
    format('%s.%s', expected_mcp_policies.table_name, expected_mcp_policies.policy_name)
    order by expected_mcp_policies.table_name, expected_mcp_policies.policy_name
  )
  into mistargeted_mcp_policies
  from expected_mcp_policies
  where not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_policy p
      on p.polrelid = c.oid
    join pg_roles r
      on r.rolname = 'mcp_session_executor'
    where n.nspname = 'public'
      and c.relname = expected_mcp_policies.table_name
      and p.polname = expected_mcp_policies.policy_name
      and r.oid = any(p.polroles)
      and 0::oid <> all(p.polroles)
  );

  if coalesce(array_length(mistargeted_mcp_policies, 1), 0) > 0 then
    raise exception 'MCP policies must target only mcp_session_executor, not PUBLIC: %',
      mistargeted_mcp_policies;
  end if;
end;
$$;

do $$
declare
  profiles_rls_enabled boolean;
  own_profile_policy text;
  shared_profile_policy text;
  shared_profile_helper text;
  mcp_profile_policies text[];
begin
  select c.relrowsecurity
  into profiles_rls_enabled
  from pg_namespace n
  join pg_class c
    on c.relnamespace = n.oid
  where n.nspname = 'public'
    and c.relname = 'profiles';

  if profiles_rls_enabled is not true then
    raise exception 'profiles must have explicit RLS enabled';
  end if;

  select lower(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g'))
  into own_profile_policy
  from pg_namespace n
  join pg_class c
    on c.relnamespace = n.oid
  join pg_policy p
    on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relname = 'profiles'
    and p.polname = 'profiles_select_own_auth_user'
    and p.polcmd = 'r';

  if own_profile_policy is null
    or own_profile_policy not like '%auth_user_id = auth.uid()%'
    or own_profile_policy not like '%deleted_at is null%' then
    raise exception 'profiles own-user SELECT policy must use auth_user_id identity and exclude deleted profiles: %',
      own_profile_policy;
  end if;

  select lower(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g'))
  into shared_profile_policy
  from pg_namespace n
  join pg_class c
    on c.relnamespace = n.oid
  join pg_policy p
    on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relname = 'profiles'
    and p.polname = 'profiles_select_shared_workspace_user_member'
    and p.polcmd = 'r'
    and 0::oid <> all(p.polroles)
    and exists (
      select 1
      from pg_roles r
      where r.rolname = 'authenticated'
        and r.oid = any(p.polroles)
    );

  if shared_profile_policy is null
    or shared_profile_policy not like '%has_shared_workspace_with_profile%'
    or shared_profile_policy not like '%deleted_at is null%' then
    raise exception 'profiles shared-workspace SELECT policy must target authenticated peers and exclude deleted profiles: %',
      shared_profile_policy;
  end if;

  select lower(pg_get_functiondef('public.has_shared_workspace_with_profile(uuid)'::regprocedure))
  into shared_profile_helper;

  if shared_profile_helper not like '%security definer%'
    or shared_profile_helper not like '%workspace_members%'
    or shared_profile_helper not like '%auth.uid()%'
    or shared_profile_helper not like '%p.deleted_at is null%' then
    raise exception 'profiles shared-workspace helper must use active shared workspace membership';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.has_shared_workspace_with_profile(uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must be able to execute profiles shared-workspace helper';
  end if;

  if has_function_privilege(
    'mcp_session_executor',
    'public.has_shared_workspace_with_profile(uuid)',
    'EXECUTE'
  ) then
    raise exception 'mcp_session_executor must not execute profiles shared-workspace helper';
  end if;

  select array_agg(
    format(
      '%s: %s',
      p.polname,
      lower(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '[[:space:]]+', ' ', 'g'))
    )
    order by p.polname
  )
  into mcp_profile_policies
  from pg_namespace n
  join pg_class c
    on c.relnamespace = n.oid
  join pg_policy p
    on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relname = 'profiles'
    and (
      lower(p.polname) like '%mcp%'
      or lower(coalesce(pg_get_expr(p.polqual, p.polrelid), '')) like '%has_active_mcp_session%'
    );

  if coalesce(array_length(mcp_profile_policies, 1), 0) > 0 then
    raise exception 'profiles must not expose MCP profile policies: %',
      mcp_profile_policies;
  end if;

  if has_table_privilege('mcp_session_executor', 'public.profiles', 'SELECT') then
    raise exception 'mcp_session_executor must not have SELECT on profiles';
  end if;
end;
$$;

do $$
declare
  missing_triggers text[];
begin
  with workspace_tables(table_name) as (
    values
      ('workspace_members'),
      ('mcp_keys'),
      ('memories'),
      ('memory_revisions'),
      ('conflicts'),
      ('workspace_tags'),
      ('memory_tags'),
      ('audit_log_memory'),
      ('audit_log_workspace'),
      ('usage_events'),
      ('workspace_invites')
  )
  select array_agg(workspace_table.table_name order by workspace_table.table_name)
  into missing_triggers
  from workspace_tables workspace_table
  where not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_trigger t
      on t.tgrelid = c.oid
    where n.nspname = 'public'
      and c.relname = workspace_table.table_name
      and t.tgname = workspace_table.table_name || '_prevent_workspace_id_update'
      and t.tgfoid = 'public.prevent_workspace_id_update()'::regprocedure
      and not t.tgisinternal
  );

  if coalesce(array_length(missing_triggers, 1), 0) > 0 then
    raise exception 'workspace_id immutability triggers missing from tables: %', missing_triggers;
  end if;
end;
$$;

do $$
declare
  missing_function_checks text[];
  forbidden_function_checks text[];
  trigger_function text;
  missing_trigger boolean;
begin
  select lower(regexp_replace(pg_get_functiondef(
    'public.prevent_mcp_key_immutable_update()'::regprocedure
  ), '[[:space:]]+', ' ', 'g'))
  into trigger_function;

  with protected_fields(field_check) as (
    values
      ('new.id is distinct from old.id'),
      ('new.workspace_id is distinct from old.workspace_id'),
      ('new.name is distinct from old.name'),
      ('new.key_prefix is distinct from old.key_prefix'),
      ('new.key_hash is distinct from old.key_hash'),
      ('new.created_by_profile_id is distinct from old.created_by_profile_id'),
      ('new.created_at is distinct from old.created_at')
  )
  select array_agg(field_check order by field_check)
  into missing_function_checks
  from protected_fields
  where trigger_function not like '%' || field_check || '%';

  if coalesce(array_length(missing_function_checks, 1), 0) > 0 then
    raise exception 'mcp_keys immutable-field trigger is missing protected field checks: %',
      missing_function_checks;
  end if;

  with mutable_fields(field_check) as (
    values
      ('new.revoked_at is distinct from old.revoked_at'),
      ('new.revoked_by_profile_id is distinct from old.revoked_by_profile_id'),
      ('new.last_used_at is distinct from old.last_used_at'),
      ('new.updated_at is distinct from old.updated_at')
  )
  select array_agg(field_check order by field_check)
  into forbidden_function_checks
  from mutable_fields
  where trigger_function like '%' || field_check || '%';

  if coalesce(array_length(forbidden_function_checks, 1), 0) > 0 then
    raise exception 'mcp_keys immutable-field trigger blocks legitimate operational fields: %',
      forbidden_function_checks;
  end if;

  select not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_trigger t
      on t.tgrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'mcp_keys'
      and t.tgname = 'mcp_keys_prevent_immutable_update'
      and t.tgfoid = 'public.prevent_mcp_key_immutable_update()'::regprocedure
      and (t.tgtype::integer & 1) = 1
      and (t.tgtype::integer & 2) = 2
      and (t.tgtype::integer & 16) = 16
      and not t.tgisinternal
  )
  into missing_trigger;

  if missing_trigger then
    raise exception 'mcp_keys immutable-field update trigger is missing';
  end if;
end;
$$;

do $$
declare
  missing_invite_constraints text[];
begin
  with required_constraints(constraint_name, required_expression) as (
    values
      (
        'workspace_invites_accepted_at_check',
        'check accepted_by_profile_id is null or accepted_at is not null'
      ),
      (
        'workspace_invites_not_accepted_and_revoked_check',
        'check accepted_at is null or revoked_at is null'
      )
  )
  select array_agg(required_constraint.constraint_name order by required_constraint.constraint_name)
  into missing_invite_constraints
  from required_constraints required_constraint
  where not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'workspace_invites'
      and con.conname = required_constraint.constraint_name
      and con.contype = 'c'
      and lower(regexp_replace(
        regexp_replace(pg_get_constraintdef(con.oid), '[()]', '', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )) = required_constraint.required_expression
  );

  if coalesce(array_length(missing_invite_constraints, 1), 0) > 0 then
    raise exception 'workspace_invites lifecycle check constraints are missing: %',
      missing_invite_constraints;
  end if;
end;
$$;

do $$
declare
  trigger_function text;
begin
  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_trigger t
      on t.tgrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'workspace_invites'
      and t.tgname = 'workspace_invites_enforce_single_active'
      and t.tgfoid = 'public.enforce_single_active_workspace_invite()'::regprocedure
      and (t.tgtype::integer & 1) = 1
      and (t.tgtype::integer & 2) = 2
      and (t.tgtype::integer & 4) = 4
      and (t.tgtype::integer & 16) = 16
      and not t.tgisinternal
  ) then
    raise exception 'workspace_invites active-invite uniqueness trigger is missing';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef('public.enforce_single_active_workspace_invite()'::regprocedure),
    '[[:space:]]+',
    ' ',
    'g'
  ))
  into trigger_function;

  if trigger_function not like '%pg_advisory_xact_lock%'
    or trigger_function not like '%lower(btrim(new.email))%'
    or trigger_function not like '%new.accepted_at is not null%'
    or trigger_function not like '%new.revoked_at is not null%'
    or trigger_function not like '%new.expires_at <= now()%'
    or trigger_function not like '%lower(btrim(existing_invite.email))%'
    or trigger_function not like '%existing_invite.accepted_at is null%'
    or trigger_function not like '%existing_invite.revoked_at is null%'
    or trigger_function not like '%existing_invite.expires_at > now()%'
    or trigger_function not like '%existing_invite.id <> new.id%' then
    raise exception 'workspace_invites active-invite uniqueness trigger is missing expiry-aware duplicate checks';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'workspace_invites'
      and indexname = 'workspace_invites_workspace_id_email_active_idx'
      and lower(indexdef) like '%lower(btrim(email))%'
      and lower(indexdef) like '%expires_at%'
      and lower(indexdef) like '%accepted_at is null%'
      and lower(indexdef) like '%revoked_at is null%'
  ) then
    raise exception 'workspace_invites active email lookup index must support expiry-aware invite uniqueness';
  end if;
end;
$$;

do $$
declare
  missing_updated_at_triggers text[];
begin
  with updated_at_tables(table_name) as (
    values
      ('profiles'),
      ('workspaces'),
      ('workspace_members'),
      ('mcp_keys'),
      ('memories'),
      ('conflicts'),
      ('workspace_tags'),
      ('workspace_invites')
  )
  select array_agg(updated_at_table.table_name order by updated_at_table.table_name)
  into missing_updated_at_triggers
  from updated_at_tables updated_at_table
  where not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_trigger t
      on t.tgrelid = c.oid
    where n.nspname = 'public'
      and c.relname = updated_at_table.table_name
      and t.tgname = updated_at_table.table_name || '_set_updated_at'
      and t.tgfoid = 'public.set_current_updated_at()'::regprocedure
      and (t.tgtype::integer & 1) = 1
      and (t.tgtype::integer & 2) = 2
      and (t.tgtype::integer & 16) = 16
      and not t.tgisinternal
  );

  if coalesce(array_length(missing_updated_at_triggers, 1), 0) > 0 then
    raise exception 'updated_at maintenance triggers missing from tables: %',
      missing_updated_at_triggers;
  end if;
end;
$$;

do $$
declare
  memory_embedding_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into memory_embedding_type
  from pg_namespace n
  join pg_class c
    on c.relnamespace = n.oid
  join pg_attribute a
    on a.attrelid = c.oid
  where n.nspname = 'public'
    and c.relname = 'memories'
    and a.attname = 'embedding'
    and not a.attisdropped;

  if memory_embedding_type is null or memory_embedding_type !~ '(^|\.)vector$' then
    raise exception 'memories.embedding must be unconstrained vector, found %', memory_embedding_type;
  end if;

  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'memories'
      and indexdef ilike '%using hnsw%'
  ) then
    raise exception 'memories should not define an ANN vector index before tier dimensions are locked';
  end if;
end;
$$;

do $$
declare
  helpers_missing_deleted_profile_check text[];
begin
  with helper_functions(function_name) as (
    values
      ('has_workspace_membership'),
      ('has_shared_workspace_with_profile'),
      ('is_workspace_admin'),
      ('is_own_workspace_memory')
  )
  select array_agg(helper_function.function_name order by helper_function.function_name)
  into helpers_missing_deleted_profile_check
  from helper_functions helper_function
  where not exists (
    select 1
    from pg_namespace n
    join pg_proc p
      on p.pronamespace = n.oid
    where n.nspname = 'public'
      and p.proname = helper_function.function_name
      and lower(pg_get_functiondef(p.oid)) like '%p.deleted_at is null%'
  );

  if coalesce(array_length(helpers_missing_deleted_profile_check, 1), 0) > 0 then
    raise exception 'membership helpers missing profiles.deleted_at check: %',
      helpers_missing_deleted_profile_check;
  end if;
end;
$$;

do $$
declare
  user_insert_check text;
  mcp_insert_check text;
  trigger_function text;
begin
  select lower(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '[[:space:]]+', ' ', 'g'))
  into user_insert_check
  from pg_namespace n
  join pg_class c
    on c.relnamespace = n.oid
  join pg_policy p
    on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relname = 'memories'
    and p.polname = 'memories_insert_user_member'
    and p.polcmd = 'a';

  if user_insert_check is null
    or user_insert_check not like '%is_own_workspace_memory%'
    or user_insert_check not like '%is_raw_memory_insert%' then
    raise exception 'memories user insert policy does not require own raw memory shape: %',
      user_insert_check;
  end if;

  select lower(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '[[:space:]]+', ' ', 'g'))
  into mcp_insert_check
  from pg_namespace n
  join pg_class c
    on c.relnamespace = n.oid
  join pg_policy p
    on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relname = 'memories'
    and p.polname = 'memories_insert_mcp_session'
    and p.polcmd = 'a';

  if mcp_insert_check is null
    or mcp_insert_check not like '%has_active_mcp_session%'
    or mcp_insert_check not like '%author_profile_id is null%'
    or mcp_insert_check not like '%is_raw_memory_insert%' then
    raise exception 'memories MCP insert policy does not require unauthored raw memory shape: %',
      mcp_insert_check;
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_trigger t
      on t.tgrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'memories'
      and t.tgname = 'memories_enforce_user_write_contract'
      and t.tgfoid = 'public.enforce_memories_user_write_contract()'::regprocedure
      and not t.tgisinternal
  ) then
    raise exception 'memories user/MCP write contract trigger is missing';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef('public.enforce_memories_user_write_contract()'::regprocedure),
    '[[:space:]]+',
    ' ',
    'g'
  ))
  into trigger_function;

  if trigger_function not like '%mcp_key%'
    or trigger_function not like '%has_active_mcp_session%'
    or trigger_function not like '%tg_op in (''update'', ''delete'')%'
    or trigger_function not like '%auth.role() = ''authenticated''%'
    or trigger_function not like '%is_workspace_admin(old.workspace_id)%'
    or trigger_function not like '%not v_is_authenticated_admin and new.kind is distinct from old.kind%'
    or trigger_function not like '%not v_is_authenticated_admin and new.kind_confidence is distinct from old.kind_confidence%'
    or trigger_function not like '%not v_is_authenticated_admin and new.deleted_at is distinct from old.deleted_at%'
    or trigger_function not like '%new.kind is distinct from old.kind%'
    or trigger_function not like '%new.status is distinct from old.status%'
    or trigger_function not like '%new.processing_tier is distinct from old.processing_tier%'
    or trigger_function not like '%new.embedding::text is distinct from old.embedding::text%'
    or trigger_function not like '%new.superseded_by_memory_id is distinct from old.superseded_by_memory_id%'
    or trigger_function not like '%new.author_profile_id is distinct from old.author_profile_id%' then
    raise exception 'memories user/MCP write contract trigger is missing protected field checks';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memory_revisions'
      and column_name = 'kind_confidence'
      and data_type = 'numeric'
  ) then
    raise exception 'memory_revisions.kind_confidence is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memory_revisions'
      and column_name = 'processed_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'memory_revisions.processed_at is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memory_revisions'
      and column_name = 'superseded_by_memory_id'
      and data_type = 'uuid'
  ) then
    raise exception 'memory_revisions.superseded_by_memory_id is missing';
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'memory_revisions'
      and con.conname = 'memory_revisions_superseded_by_memory_workspace_fk'
      and con.contype = 'f'
      and lower(regexp_replace(pg_get_constraintdef(con.oid), '[[:space:]]+', ' ', 'g'))
        like '%foreign key (workspace_id, superseded_by_memory_id) references %memories(workspace_id, id)%'
  ) then
    raise exception 'memory_revisions superseded-memory foreign key is missing';
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'memory_revisions'
      and con.conname = 'memory_revisions_kind_confidence_check'
      and con.contype = 'c'
      and lower(pg_get_constraintdef(con.oid)) like '%kind_confidence is null%'
      and lower(pg_get_constraintdef(con.oid)) like '%kind_confidence >=%'
      and lower(pg_get_constraintdef(con.oid)) like '%kind_confidence <=%'
  ) then
    raise exception 'memory_revisions kind_confidence range check is missing';
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'memory_revisions'
      and con.conname = 'memory_revisions_not_self_superseded_check'
      and con.contype = 'c'
      and lower(pg_get_constraintdef(con.oid)) like '%superseded_by_memory_id is null%'
      and lower(pg_get_constraintdef(con.oid)) like '%superseded_by_memory_id <> memory_id%'
  ) then
    raise exception 'memory_revisions self-supersession check is missing';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conflicts'
      and column_name = 'merged_memory_id'
      and data_type = 'uuid'
  ) then
    raise exception 'conflicts.merged_memory_id is missing';
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'conflicts'
      and con.conname = 'conflicts_merged_memory_workspace_fk'
      and con.contype = 'f'
  ) then
    raise exception 'conflicts merged-memory foreign key is missing';
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'conflicts'
      and con.conname = 'conflicts_merged_memory_check'
      and con.contype = 'c'
  ) then
    raise exception 'conflicts merged-memory check constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'conflicts'
      and con.conname = 'conflicts_unresolved_empty_result_check'
      and con.contype = 'c'
  ) then
    raise exception 'conflicts unresolved-empty-result check constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'conflicts'
      and con.conname = 'conflicts_winner_status_check'
      and con.contype = 'c'
  ) then
    raise exception 'conflicts winner-status check constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_constraint con
      on con.conrelid = c.oid
    where n.nspname = 'public'
      and c.relname = 'conflicts'
      and con.conname = 'conflicts_resolved_at_status_check'
      and con.contype = 'c'
  ) then
    raise exception 'conflicts resolved-at status check constraint is missing';
  end if;
end;
$$;

select 'ALEX-001 quality checks passed' as result;
