-- Alexandria initial Supabase schema.
-- This migration is intentionally database-only: locked tables, constraints,
-- indexes, the MCP session helper, and baseline tenant-isolation RLS.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

do $$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'mcp_session_executor'
  ) then
    create role mcp_session_executor nologin noinherit nobypassrls;
  end if;
end;
$$;

alter role mcp_session_executor with nologin noinherit nobypassrls;
grant usage on schema public, extensions to mcp_session_executor;

create table public.profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null,
  context_description text not null,
  tier text not null default 'basic',
  conflict_thresholds jsonb not null default '{"duplicate": 0.97, "conflict": 0.85}'::jsonb,
  created_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_empty check (length(btrim(name)) > 0),
  constraint workspaces_slug_not_empty check (length(btrim(slug)) > 0),
  constraint workspaces_context_description_min_length check (length(btrim(context_description)) >= 30),
  constraint workspaces_slug_key unique (slug),
  constraint workspaces_tier_check check (tier in ('basic', 'pro'))
);

create table public.workspace_members (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  profile_id uuid not null references public.profiles(id),
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_members_role_check check (role in ('member', 'admin')),
  constraint workspace_members_workspace_id_profile_id_key unique (workspace_id, profile_id)
);

create table public.mcp_keys (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  created_by_profile_id uuid references public.profiles(id),
  revoked_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint mcp_keys_name_not_empty check (length(btrim(name)) > 0),
  constraint mcp_keys_key_prefix_not_empty check (length(btrim(key_prefix)) > 0),
  constraint mcp_keys_workspace_id_id_key unique (workspace_id, id),
  constraint mcp_keys_key_prefix_key unique (key_prefix)
);

create table public.memories (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  author_profile_id uuid references public.profiles(id),
  superseded_by_memory_id uuid,
  kind text not null default 'unknown',
  kind_confidence numeric,
  status text not null default 'processing',
  processing_tier text not null default 'basic',
  title text,
  content text not null,
  embedding extensions.vector,
  metadata jsonb not null default '{}'::jsonb,
  search_document tsvector generated always as (
    to_tsvector(
      'english'::regconfig,
      coalesce(title, '') || ' ' || coalesce(content, '')
    )
  ) stored,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint memories_superseded_by_memory_workspace_fk
    foreign key (workspace_id, superseded_by_memory_id)
    references public.memories(workspace_id, id),
  constraint memories_kind_check check (kind in ('policy', 'fact', 'judgment', 'unknown')),
  constraint memories_kind_confidence_check check (
    kind_confidence is null
    or (kind_confidence >= 0 and kind_confidence <= 1)
  ),
  constraint memories_status_check check (status in ('processing', 'active', 'conflict', 'failed')),
  constraint memories_processing_tier_check check (processing_tier in ('basic', 'pro')),
  constraint memories_not_self_superseded_check check (
    superseded_by_memory_id is null or superseded_by_memory_id <> id
  ),
  constraint memories_workspace_id_id_key unique (workspace_id, id)
);

create table public.memory_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  memory_id uuid not null,
  author_profile_id uuid references public.profiles(id),
  superseded_by_memory_id uuid,
  revision_number integer not null,
  kind text not null,
  kind_confidence numeric,
  status text not null,
  processing_tier text not null,
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint memory_revisions_memory_workspace_fk
    foreign key (workspace_id, memory_id)
    references public.memories(workspace_id, id),
  constraint memory_revisions_superseded_by_memory_workspace_fk
    foreign key (workspace_id, superseded_by_memory_id)
    references public.memories(workspace_id, id),
  constraint memory_revisions_revision_number_check check (revision_number > 0),
  constraint memory_revisions_kind_check check (kind in ('policy', 'fact', 'judgment', 'unknown')),
  constraint memory_revisions_kind_confidence_check check (
    kind_confidence is null
    or (kind_confidence >= 0 and kind_confidence <= 1)
  ),
  constraint memory_revisions_status_check check (status in ('processing', 'active', 'conflict', 'failed')),
  constraint memory_revisions_processing_tier_check check (processing_tier in ('basic', 'pro')),
  constraint memory_revisions_not_self_superseded_check check (
    superseded_by_memory_id is null or superseded_by_memory_id <> memory_id
  ),
  constraint memory_revisions_memory_id_revision_number_key unique (memory_id, revision_number)
);

create table public.conflicts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  source_memory_id uuid not null,
  target_memory_id uuid not null,
  winner_memory_id uuid,
  merged_memory_id uuid,
  status text not null default 'unresolved',
  resolution_strategy text,
  resolution text,
  resolution_notes text,
  resolved_by_profile_id uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint conflicts_source_memory_workspace_fk
    foreign key (workspace_id, source_memory_id)
    references public.memories(workspace_id, id),
  constraint conflicts_target_memory_workspace_fk
    foreign key (workspace_id, target_memory_id)
    references public.memories(workspace_id, id),
  constraint conflicts_winner_memory_workspace_fk
    foreign key (workspace_id, winner_memory_id)
    references public.memories(workspace_id, id),
  constraint conflicts_merged_memory_workspace_fk
    foreign key (workspace_id, merged_memory_id)
    references public.memories(workspace_id, id),
  constraint conflicts_status_check check (
    status in ('unresolved', 'auto_resolved', 'admin_resolved', 'merged', 'kept_both')
  ),
  constraint conflicts_resolution_strategy_not_empty check (
    resolution_strategy is null or length(btrim(resolution_strategy)) > 0
  ),
  constraint conflicts_distinct_memories_check check (source_memory_id <> target_memory_id),
  constraint conflicts_winner_memory_check check (
    winner_memory_id is null
    or winner_memory_id in (source_memory_id, target_memory_id)
  ),
  constraint conflicts_unresolved_empty_result_check check (
    status <> 'unresolved'
    or (
      winner_memory_id is null
      and merged_memory_id is null
      and resolution_strategy is null
      and resolution is null
      and resolved_by_profile_id is null
      and resolved_at is null
    )
  ),
  constraint conflicts_winner_status_check check (
    (
      status in ('auto_resolved', 'admin_resolved')
      and winner_memory_id is not null
    )
    or (
      status not in ('auto_resolved', 'admin_resolved')
      and winner_memory_id is null
    )
  ),
  constraint conflicts_resolved_at_status_check check (
    status = 'unresolved' or resolved_at is not null
  ),
  constraint conflicts_merged_memory_check check (
    (
      status = 'merged'
      and merged_memory_id is not null
      and merged_memory_id <> source_memory_id
      and merged_memory_id <> target_memory_id
      and winner_memory_id is null
    )
    or (
      status <> 'merged'
      and merged_memory_id is null
    )
  ),
  constraint conflicts_workspace_id_id_key unique (workspace_id, id)
);

create table public.workspace_tags (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null,
  display_name text,
  description text,
  parent_workspace_tag_id uuid,
  curated boolean not null default false,
  created_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workspace_tags_parent_workspace_tag_workspace_fk
    foreign key (workspace_id, parent_workspace_tag_id)
    references public.workspace_tags(workspace_id, id),
  constraint workspace_tags_name_not_empty check (length(btrim(name)) > 0),
  constraint workspace_tags_workspace_id_id_key unique (workspace_id, id),
  constraint workspace_tags_workspace_id_name_key unique (workspace_id, name)
);

create table public.memory_tags (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  memory_id uuid not null,
  workspace_tag_id uuid not null,
  created_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint memory_tags_memory_workspace_fk
    foreign key (workspace_id, memory_id)
    references public.memories(workspace_id, id),
  constraint memory_tags_workspace_tag_workspace_fk
    foreign key (workspace_id, workspace_tag_id)
    references public.workspace_tags(workspace_id, id)
);

create table public.audit_log_memory (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  actor_type text not null,
  actor_profile_id uuid references public.profiles(id),
  actor_mcp_key_id uuid,
  actor_label text,
  action text not null,
  target_memory_id uuid,
  target_conflict_id uuid,
  target_workspace_tag_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_memory_actor_mcp_key_workspace_fk
    foreign key (workspace_id, actor_mcp_key_id)
    references public.mcp_keys(workspace_id, id),
  constraint audit_log_memory_target_memory_workspace_fk
    foreign key (workspace_id, target_memory_id)
    references public.memories(workspace_id, id),
  constraint audit_log_memory_target_conflict_workspace_fk
    foreign key (workspace_id, target_conflict_id)
    references public.conflicts(workspace_id, id),
  constraint audit_log_memory_target_workspace_tag_workspace_fk
    foreign key (workspace_id, target_workspace_tag_id)
    references public.workspace_tags(workspace_id, id),
  constraint audit_log_memory_actor_type_check check (actor_type in ('profile', 'mcp_key')),
  constraint audit_log_memory_action_not_empty check (length(btrim(action)) > 0)
);

create table public.audit_log_workspace (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  actor_type text not null,
  actor_profile_id uuid references public.profiles(id),
  actor_mcp_key_id uuid,
  actor_label text,
  action text not null,
  target_profile_id uuid references public.profiles(id),
  target_mcp_key_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_workspace_actor_mcp_key_workspace_fk
    foreign key (workspace_id, actor_mcp_key_id)
    references public.mcp_keys(workspace_id, id),
  constraint audit_log_workspace_target_mcp_key_workspace_fk
    foreign key (workspace_id, target_mcp_key_id)
    references public.mcp_keys(workspace_id, id),
  constraint audit_log_workspace_actor_type_check check (actor_type in ('profile', 'mcp_key')),
  constraint audit_log_workspace_action_not_empty check (length(btrim(action)) > 0)
);

create table public.usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  actor_profile_id uuid references public.profiles(id),
  actor_mcp_key_id uuid,
  event_type text not null,
  processing_tier text not null default 'basic',
  llm_input_tokens integer not null default 0,
  llm_output_tokens integer not null default 0,
  llm_model text,
  embedding_tokens integer not null default 0,
  cost_estimate_cents integer not null default 0,
  occurred_at timestamptz not null default now(),
  constraint usage_events_actor_mcp_key_workspace_fk
    foreign key (workspace_id, actor_mcp_key_id)
    references public.mcp_keys(workspace_id, id),
  constraint usage_events_event_type_not_empty check (length(btrim(event_type)) > 0),
  constraint usage_events_processing_tier_check check (processing_tier in ('basic', 'pro')),
  constraint usage_events_llm_input_tokens_check check (llm_input_tokens >= 0),
  constraint usage_events_llm_output_tokens_check check (llm_output_tokens >= 0),
  constraint usage_events_embedding_tokens_check check (embedding_tokens >= 0),
  constraint usage_events_cost_estimate_cents_check check (cost_estimate_cents >= 0)
);

create table public.workspace_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  email text not null,
  role text not null default 'member',
  token text not null,
  invited_by_profile_id uuid not null references public.profiles(id),
  accepted_by_profile_id uuid references public.profiles(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_invites_role_check check (role in ('member', 'admin')),
  constraint workspace_invites_email_not_empty check (length(btrim(email)) > 0),
  constraint workspace_invites_token_not_empty check (length(btrim(token)) > 0),
  constraint workspace_invites_token_key unique (token),
  constraint workspace_invites_accepted_profile_check check (
    accepted_at is null or accepted_by_profile_id is not null
  ),
  constraint workspace_invites_accepted_at_check check (
    accepted_by_profile_id is null or accepted_at is not null
  ),
  constraint workspace_invites_not_accepted_and_revoked_check check (
    accepted_at is null or revoked_at is null
  )
);

-- Tenant-scoped and lookup indexes. The core workspace-owned indexes lead
-- with workspace_id; the profile/member indexes support auth.uid() membership checks.
create index workspace_members_workspace_id_role_idx
  on public.workspace_members (workspace_id, role);

create index workspace_members_profile_id_workspace_id_idx
  on public.workspace_members (profile_id, workspace_id);

create index mcp_keys_workspace_id_active_idx
  on public.mcp_keys (workspace_id, created_at desc)
  where revoked_at is null;

create index memories_workspace_id_status_updated_at_idx
  on public.memories (workspace_id, status, updated_at desc)
  where deleted_at is null and superseded_by_memory_id is null;

create index memories_workspace_id_active_current_idx
  on public.memories (workspace_id, kind, status, updated_at desc)
  where deleted_at is null and superseded_by_memory_id is null;

create index memories_workspace_id_embedding_candidates_idx
  on public.memories (workspace_id, kind, status, id)
  where deleted_at is null and superseded_by_memory_id is null and embedding is not null;

-- ANN vector indexes are intentionally deferred until the backend locks the
-- concrete dimensions used by each processing tier/model.

create index memories_search_document_idx
  on public.memories using gin (search_document)
  where deleted_at is null and superseded_by_memory_id is null;

create index memory_revisions_workspace_id_memory_id_revision_number_idx
  on public.memory_revisions (workspace_id, memory_id, revision_number desc)
  where deleted_at is null;

create index conflicts_workspace_id_status_created_at_idx
  on public.conflicts (workspace_id, status, created_at desc)
  where deleted_at is null;

create index workspace_tags_workspace_id_parent_workspace_tag_id_idx
  on public.workspace_tags (workspace_id, parent_workspace_tag_id)
  where deleted_at is null;

create unique index memory_tags_workspace_id_memory_id_workspace_tag_id_active_key
  on public.memory_tags (workspace_id, memory_id, workspace_tag_id)
  where deleted_at is null;

create index memory_tags_workspace_id_workspace_tag_id_idx
  on public.memory_tags (workspace_id, workspace_tag_id)
  where deleted_at is null;

create index audit_log_memory_workspace_id_target_memory_id_created_at_idx
  on public.audit_log_memory (workspace_id, target_memory_id, created_at desc);

create index audit_log_memory_workspace_id_target_conflict_id_created_at_idx
  on public.audit_log_memory (workspace_id, target_conflict_id, created_at desc);

create index audit_log_memory_workspace_id_action_created_at_idx
  on public.audit_log_memory (workspace_id, action, created_at desc);

create index audit_log_workspace_workspace_id_created_at_idx
  on public.audit_log_workspace (workspace_id, created_at desc);

create index audit_log_workspace_workspace_id_action_created_at_idx
  on public.audit_log_workspace (workspace_id, action, created_at desc);

create index usage_events_workspace_id_occurred_at_idx
  on public.usage_events (workspace_id, occurred_at desc);

create index usage_events_workspace_id_event_type_occurred_at_idx
  on public.usage_events (workspace_id, event_type, occurred_at desc);

create index workspace_invites_workspace_id_email_active_idx
  on public.workspace_invites (workspace_id, lower(btrim(email)), expires_at)
  where accepted_at is null and revoked_at is null;

create index workspace_invites_workspace_id_accepted_at_idx
  on public.workspace_invites (workspace_id, accepted_at);

create index workspace_invites_email_idx
  on public.workspace_invites (email);

create or replace function public.set_mcp_session(
  p_workspace_id uuid,
  p_mcp_key_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.current_workspace_id', p_workspace_id::text, true);
  perform set_config('app.current_mcp_key_id', p_mcp_key_id::text, true);
  perform set_config('app.actor_kind', 'mcp_key', true);
end;
$$;

-- The MCP session helper should be called only after the presented MCP key
-- has been verified against key_hash, and only while the current database
-- role is the non-BYPASSRLS MCP executor. service_role bypasses RLS, so it
-- must never be the current role for MCP tenant-data queries.
revoke all on function public.set_mcp_session(uuid, uuid) from public;
revoke all on function public.set_mcp_session(uuid, uuid) from anon;
revoke all on function public.set_mcp_session(uuid, uuid) from authenticated;
revoke all on function public.set_mcp_session(uuid, uuid) from service_role;
grant execute on function public.set_mcp_session(uuid, uuid) to mcp_session_executor;

-- Used by workspace_members RLS so members can see membership rows across
-- their workspace without recursively querying workspace_members.
create or replace function public.has_workspace_membership(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.profiles p
      on p.id = wm.profile_id
    where wm.workspace_id = p_workspace_id
      and p.auth_user_id = auth.uid()
      and p.deleted_at is null
  );
$$;

revoke all on function public.has_workspace_membership(uuid) from public;
revoke all on function public.has_workspace_membership(uuid) from anon;
revoke all on function public.has_workspace_membership(uuid) from service_role;
revoke all on function public.has_workspace_membership(uuid) from mcp_session_executor;
grant execute on function public.has_workspace_membership(uuid) to authenticated;

-- Used by profiles RLS so authenticated members can see active peer profiles
-- for workspaces they share, without recursively evaluating profiles RLS.
create or replace function public.has_shared_workspace_with_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members peer_wm
    join public.workspace_members current_wm
      on current_wm.workspace_id = peer_wm.workspace_id
    join public.profiles p
      on p.id = current_wm.profile_id
    where peer_wm.profile_id = p_profile_id
      and p.auth_user_id = auth.uid()
      and p.deleted_at is null
  );
$$;

revoke all on function public.has_shared_workspace_with_profile(uuid) from public;
revoke all on function public.has_shared_workspace_with_profile(uuid) from anon;
revoke all on function public.has_shared_workspace_with_profile(uuid) from service_role;
revoke all on function public.has_shared_workspace_with_profile(uuid) from mcp_session_executor;
grant execute on function public.has_shared_workspace_with_profile(uuid) to authenticated;

-- Admin-only web write policies share this predicate so workspace settings
-- and membership management stay tied to workspace admin membership.
create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.profiles p
      on p.id = wm.profile_id
    where wm.workspace_id = p_workspace_id
      and p.auth_user_id = auth.uid()
      and p.deleted_at is null
      and wm.role = 'admin'
  );
$$;

revoke all on function public.is_workspace_admin(uuid) from public;
revoke all on function public.is_workspace_admin(uuid) from anon;
revoke all on function public.is_workspace_admin(uuid) from service_role;
revoke all on function public.is_workspace_admin(uuid) from mcp_session_executor;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

-- Identifies user-authored memories while also requiring workspace membership.
create or replace function public.is_own_workspace_memory(
  p_workspace_id uuid,
  p_author_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.workspace_members wm
      on wm.profile_id = p.id
      and wm.workspace_id = p_workspace_id
    where p.id = p_author_profile_id
      and p.auth_user_id = auth.uid()
      and p.deleted_at is null
  );
$$;

revoke all on function public.is_own_workspace_memory(uuid, uuid) from public;
revoke all on function public.is_own_workspace_memory(uuid, uuid) from anon;
revoke all on function public.is_own_workspace_memory(uuid, uuid) from service_role;
revoke all on function public.is_own_workspace_memory(uuid, uuid) from mcp_session_executor;
grant execute on function public.is_own_workspace_memory(uuid, uuid) to authenticated;

-- Validates transaction-local MCP session settings against an active,
-- non-revoked key in the requested workspace.
create or replace function public.has_active_mcp_session(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select current_setting('app.actor_kind', true) = 'mcp_key'
    and p_workspace_id = nullif(current_setting('app.current_workspace_id', true), '')::uuid
    and exists (
      select 1
      from public.mcp_keys mk
      where mk.workspace_id = p_workspace_id
        and mk.id = nullif(current_setting('app.current_mcp_key_id', true), '')::uuid
        and mk.revoked_at is null
  );
$$;

revoke all on function public.has_active_mcp_session(uuid) from public;
revoke all on function public.has_active_mcp_session(uuid) from anon;
revoke all on function public.has_active_mcp_session(uuid) from authenticated;
revoke all on function public.has_active_mcp_session(uuid) from service_role;
grant execute on function public.has_active_mcp_session(uuid) to mcp_session_executor;

-- Workspace ownership is immutable. RLS update policies evaluate old and new
-- rows separately, so a trigger blocks cross-workspace re-homing even when a
-- caller has access to both workspaces.
create or replace function public.prevent_workspace_id_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_mcp_key_immutable_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.name is distinct from old.name
    or new.key_prefix is distinct from old.key_prefix
    or new.key_hash is distinct from old.key_hash
    or new.created_by_profile_id is distinct from old.created_by_profile_id
    or new.created_at is distinct from old.created_at then
    raise exception 'mcp key identity, material, and creation fields cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.set_current_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_raw_memory_insert(
  p_kind text,
  p_kind_confidence numeric,
  p_status text,
  p_processing_tier text,
  p_embedding extensions.vector,
  p_superseded_by_memory_id uuid,
  p_processed_at timestamptz,
  p_deleted_at timestamptz
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_kind = 'unknown'
    and p_kind_confidence is null
    and p_status = 'processing'
    and p_processing_tier = 'basic'
    and p_embedding is null
    and p_superseded_by_memory_id is null
    and p_processed_at is null
    and p_deleted_at is null;
$$;

revoke all on function public.is_raw_memory_insert(
  text,
  numeric,
  text,
  text,
  extensions.vector,
  uuid,
  timestamptz,
  timestamptz
) from public;
revoke all on function public.is_raw_memory_insert(
  text,
  numeric,
  text,
  text,
  extensions.vector,
  uuid,
  timestamptz,
  timestamptz
) from anon;
revoke all on function public.is_raw_memory_insert(
  text,
  numeric,
  text,
  text,
  extensions.vector,
  uuid,
  timestamptz,
  timestamptz
) from service_role;
grant execute on function public.is_raw_memory_insert(
  text,
  numeric,
  text,
  text,
  extensions.vector,
  uuid,
  timestamptz,
  timestamptz
) to authenticated, mcp_session_executor;

create or replace function public.enforce_single_active_workspace_invite()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_email_key text := lower(btrim(new.email));
  v_has_active_duplicate boolean;
begin
  if new.accepted_at is not null
    or new.revoked_at is not null
    or new.expires_at <= now() then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.workspace_id::text || ':' || v_email_key, 0)
  );

  select exists (
    select 1
    from public.workspace_invites existing_invite
    where existing_invite.workspace_id = new.workspace_id
      and lower(btrim(existing_invite.email)) = v_email_key
      and existing_invite.accepted_at is null
      and existing_invite.revoked_at is null
      and existing_invite.expires_at > now()
      and existing_invite.id <> new.id
  )
  into v_has_active_duplicate;

  if v_has_active_duplicate then
    raise exception 'Workspace already has an active invite for this email';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_memories_user_write_contract()
returns trigger
language plpgsql
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_kind text := current_setting('app.actor_kind', true);
  v_is_service_context boolean :=
    auth.role() = 'service_role'
    or current_user in ('service_role', 'postgres', 'supabase_admin');
  v_is_authenticated_admin boolean := false;
begin
  if v_actor_kind = 'mcp_key' and tg_op in ('UPDATE', 'DELETE') then
    raise exception 'MCP sessions cannot update or delete memories';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if v_actor_kind is distinct from 'mcp_key' and v_is_service_context then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_actor_kind = 'mcp_key'
      and public.has_active_mcp_session(new.workspace_id) is not true then
      raise exception 'MCP memory inserts require an active MCP session';
    end if;

    if v_actor_kind = 'mcp_key' and new.author_profile_id is not null then
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

  if tg_op = 'UPDATE' then
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

create trigger workspace_members_prevent_workspace_id_update
  before update of workspace_id on public.workspace_members
  for each row execute function public.prevent_workspace_id_update();

create trigger mcp_keys_prevent_workspace_id_update
  before update of workspace_id on public.mcp_keys
  for each row execute function public.prevent_workspace_id_update();

create trigger mcp_keys_prevent_immutable_update
  before update on public.mcp_keys
  for each row execute function public.prevent_mcp_key_immutable_update();

create trigger memories_prevent_workspace_id_update
  before update of workspace_id on public.memories
  for each row execute function public.prevent_workspace_id_update();

create trigger memories_enforce_user_write_contract
  before insert or update or delete on public.memories
  for each row execute function public.enforce_memories_user_write_contract();

create trigger memory_revisions_prevent_workspace_id_update
  before update of workspace_id on public.memory_revisions
  for each row execute function public.prevent_workspace_id_update();

create trigger conflicts_prevent_workspace_id_update
  before update of workspace_id on public.conflicts
  for each row execute function public.prevent_workspace_id_update();

create trigger workspace_tags_prevent_workspace_id_update
  before update of workspace_id on public.workspace_tags
  for each row execute function public.prevent_workspace_id_update();

create trigger memory_tags_prevent_workspace_id_update
  before update of workspace_id on public.memory_tags
  for each row execute function public.prevent_workspace_id_update();

create trigger audit_log_memory_prevent_workspace_id_update
  before update of workspace_id on public.audit_log_memory
  for each row execute function public.prevent_workspace_id_update();

create trigger audit_log_workspace_prevent_workspace_id_update
  before update of workspace_id on public.audit_log_workspace
  for each row execute function public.prevent_workspace_id_update();

create trigger usage_events_prevent_workspace_id_update
  before update of workspace_id on public.usage_events
  for each row execute function public.prevent_workspace_id_update();

create trigger workspace_invites_prevent_workspace_id_update
  before update of workspace_id on public.workspace_invites
  for each row execute function public.prevent_workspace_id_update();

create trigger workspace_invites_enforce_single_active
  before insert or update on public.workspace_invites
  for each row execute function public.enforce_single_active_workspace_invite();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_current_updated_at();

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_current_updated_at();

create trigger workspace_members_set_updated_at
  before update on public.workspace_members
  for each row execute function public.set_current_updated_at();

create trigger mcp_keys_set_updated_at
  before update on public.mcp_keys
  for each row execute function public.set_current_updated_at();

create trigger memories_set_updated_at
  before update on public.memories
  for each row execute function public.set_current_updated_at();

create trigger conflicts_set_updated_at
  before update on public.conflicts
  for each row execute function public.set_current_updated_at();

create trigger workspace_tags_set_updated_at
  before update on public.workspace_tags
  for each row execute function public.set_current_updated_at();

create trigger workspace_invites_set_updated_at
  before update on public.workspace_invites
  for each row execute function public.set_current_updated_at();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.mcp_keys enable row level security;
alter table public.memories enable row level security;
alter table public.memory_revisions enable row level security;
alter table public.conflicts enable row level security;
alter table public.workspace_tags enable row level security;
alter table public.memory_tags enable row level security;
alter table public.audit_log_memory enable row level security;
alter table public.audit_log_workspace enable row level security;
alter table public.usage_events enable row level security;
alter table public.workspace_invites enable row level security;

-- User-path SELECT policies mostly treat a profile as a workspace member when
-- a workspace_members row exists for a non-deleted profiles.auth_user_id =
-- auth.uid(). Governance and admin-owned tables use the narrower
-- workspace-admin boundary.
create policy profiles_select_own_auth_user
  on public.profiles
  for select
  to authenticated
  using (
    auth_user_id = auth.uid()
    and deleted_at is null
  );

create policy profiles_select_shared_workspace_user_member
  on public.profiles
  for select
  to authenticated
  using (
    deleted_at is null
    and public.has_shared_workspace_with_profile(id)
  );

create policy workspace_members_select_user_workspace_member
  on public.workspace_members
  for select
  to authenticated
  using (public.has_workspace_membership(workspace_id));

create policy workspaces_select_user_member
  on public.workspaces
  for select
  to authenticated
  using (public.has_workspace_membership(id));

create policy mcp_keys_select_user_admin
  on public.mcp_keys
  for select
  to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy memories_select_user_member
  on public.memories
  for select
  to authenticated
  using (public.has_workspace_membership(workspace_id));

create policy memory_revisions_select_user_member
  on public.memory_revisions
  for select
  to authenticated
  using (public.has_workspace_membership(workspace_id));

create policy conflicts_select_user_admin
  on public.conflicts
  for select
  to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy workspace_tags_select_user_member
  on public.workspace_tags
  for select
  to authenticated
  using (public.has_workspace_membership(workspace_id));

create policy memory_tags_select_user_member
  on public.memory_tags
  for select
  to authenticated
  using (public.has_workspace_membership(workspace_id));

create policy audit_log_memory_select_user_admin
  on public.audit_log_memory
  for select
  to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy audit_log_workspace_select_user_admin
  on public.audit_log_workspace
  for select
  to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy usage_events_select_user_admin
  on public.usage_events
  for select
  to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy workspace_invites_select_user_admin
  on public.workspace_invites
  for select
  to authenticated
  using (public.is_workspace_admin(workspace_id));

-- MCP-path SELECT policies require transaction-local session settings and an
-- active, non-revoked mcp_keys row in the same workspace.
-- Governance/admin-owned tables intentionally have no MCP SELECT policy.
create policy workspaces_select_mcp_session
  on public.workspaces
  for select
  to mcp_session_executor
  using (public.has_active_mcp_session(id));

create policy workspace_members_select_mcp_session
  on public.workspace_members
  for select
  to mcp_session_executor
  using (public.has_active_mcp_session(workspace_id));

create policy memories_select_mcp_session
  on public.memories
  for select
  to mcp_session_executor
  using (public.has_active_mcp_session(workspace_id));

create policy memory_revisions_select_mcp_session
  on public.memory_revisions
  for select
  to mcp_session_executor
  using (public.has_active_mcp_session(workspace_id));

create policy workspace_tags_select_mcp_session
  on public.workspace_tags
  for select
  to mcp_session_executor
  using (public.has_active_mcp_session(workspace_id));

create policy memory_tags_select_mcp_session
  on public.memory_tags
  for select
  to mcp_session_executor
  using (public.has_active_mcp_session(workspace_id));

grant select on
  public.workspaces,
  public.workspace_members,
  public.memories,
  public.memory_revisions,
  public.workspace_tags,
  public.memory_tags
to mcp_session_executor;

-- Conservative write scaffolding. Members and validated MCP sessions can only
-- insert raw pre-processing memories. Users can update their own memories, and
-- admins can update workspace memories, but a trigger protects system-managed
-- memory fields from the normal user/MCP paths. Admin web writes manage MCP
-- keys, invites, conflict resolution, workspace settings, and membership rows,
-- including deleting membership rows for removal. No hard-delete policies are
-- granted for user-content tables.
create policy memories_insert_user_member
  on public.memories
  for insert
  to authenticated
  with check (
    public.is_own_workspace_memory(workspace_id, author_profile_id)
    and public.is_raw_memory_insert(
      kind,
      kind_confidence,
      status,
      processing_tier,
      embedding,
      superseded_by_memory_id,
      processed_at,
      deleted_at
    )
  );

create policy memories_insert_mcp_session
  on public.memories
  for insert
  to mcp_session_executor
  with check (
    public.has_active_mcp_session(workspace_id)
    and author_profile_id is null
    and public.is_raw_memory_insert(
      kind,
      kind_confidence,
      status,
      processing_tier,
      embedding,
      superseded_by_memory_id,
      processed_at,
      deleted_at
    )
  );

grant insert on public.memories to mcp_session_executor;

create policy memories_update_user_admin
  on public.memories
  for update
  to authenticated
  using (
    public.is_own_workspace_memory(workspace_id, author_profile_id)
    or public.is_workspace_admin(workspace_id)
  )
  with check (
    public.is_own_workspace_memory(workspace_id, author_profile_id)
    or public.is_workspace_admin(workspace_id)
  );

create policy mcp_keys_insert_user_admin
  on public.mcp_keys
  for insert
  to authenticated
  with check (public.is_workspace_admin(workspace_id));

create policy mcp_keys_update_user_admin
  on public.mcp_keys
  for update
  to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy workspace_invites_insert_user_admin
  on public.workspace_invites
  for insert
  to authenticated
  with check (public.is_workspace_admin(workspace_id));

create policy workspace_invites_update_user_admin
  on public.workspace_invites
  for update
  to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy conflicts_update_user_admin
  on public.conflicts
  for update
  to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy workspaces_update_user_admin
  on public.workspaces
  for update
  to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

create policy workspace_members_insert_user_admin
  on public.workspace_members
  for insert
  to authenticated
  with check (public.is_workspace_admin(workspace_id));

create policy workspace_members_update_user_admin
  on public.workspace_members
  for update
  to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy workspace_members_delete_user_admin
  on public.workspace_members
  for delete
  to authenticated
  using (public.is_workspace_admin(workspace_id));
