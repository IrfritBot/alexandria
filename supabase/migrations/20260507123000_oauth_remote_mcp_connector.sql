-- IRF-130: OAuth-based remote MCP connector storage and private RPCs.

create table public.oauth_clients (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id text not null unique,
  client_name text not null,
  redirect_uris jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_clients_client_id_not_empty check (length(btrim(client_id)) > 0),
  constraint oauth_clients_client_name_not_empty check (length(btrim(client_name)) > 0),
  constraint oauth_clients_redirect_uris_array check (
    jsonb_typeof(redirect_uris) = 'array'
    and jsonb_array_length(redirect_uris) > 0
  )
);

create table public.oauth_authorization_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null references public.oauth_clients(client_id),
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  profile_id uuid not null references public.profiles(id),
  workspace_id uuid not null references public.workspaces(id),
  scopes text[] not null default '{}'::text[],
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_authorization_codes_code_hash_not_empty check (length(btrim(code_hash)) > 0),
  constraint oauth_authorization_codes_redirect_uri_not_empty check (length(btrim(redirect_uri)) > 0),
  constraint oauth_authorization_codes_code_challenge_not_empty check (length(btrim(code_challenge)) > 0),
  constraint oauth_authorization_codes_challenge_method_check check (code_challenge_method = 'S256')
);

create table public.oauth_access_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash text not null unique,
  refresh_token_hash text unique,
  client_id text not null references public.oauth_clients(client_id),
  profile_id uuid not null references public.profiles(id),
  workspace_id uuid not null references public.workspaces(id),
  mcp_key_id uuid not null references public.mcp_keys(id),
  scopes text[] not null default '{}'::text[],
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_access_tokens_token_hash_not_empty check (length(btrim(token_hash)) > 0),
  constraint oauth_access_tokens_refresh_token_hash_not_empty check (
    refresh_token_hash is null or length(btrim(refresh_token_hash)) > 0
  )
);

create index oauth_authorization_codes_client_id_created_at_idx
  on public.oauth_authorization_codes (client_id, created_at desc);

create index oauth_access_tokens_workspace_profile_created_at_idx
  on public.oauth_access_tokens (workspace_id, profile_id, created_at desc);

create index oauth_access_tokens_client_id_created_at_idx
  on public.oauth_access_tokens (client_id, created_at desc);

alter table public.oauth_clients enable row level security;
alter table public.oauth_authorization_codes enable row level security;
alter table public.oauth_access_tokens enable row level security;

revoke all on public.oauth_clients from public;
revoke all on public.oauth_clients from anon;
revoke all on public.oauth_clients from authenticated;
revoke all on public.oauth_clients from mcp_session_executor;

revoke all on public.oauth_authorization_codes from public;
revoke all on public.oauth_authorization_codes from anon;
revoke all on public.oauth_authorization_codes from authenticated;
revoke all on public.oauth_authorization_codes from mcp_session_executor;

revoke all on public.oauth_access_tokens from public;
revoke all on public.oauth_access_tokens from anon;
revoke all on public.oauth_access_tokens from authenticated;
revoke all on public.oauth_access_tokens from mcp_session_executor;

grant select, insert, update, delete on public.oauth_clients to service_role;
grant select, insert, update, delete on public.oauth_authorization_codes to service_role;
grant select, insert, update, delete on public.oauth_access_tokens to service_role;

create trigger oauth_clients_set_updated_at
  before update on public.oauth_clients
  for each row execute function public.set_current_updated_at();

create or replace function public.consume_oauth_authorization_code(
  p_code_hash text
)
returns table (
  id uuid,
  code_hash text,
  client_id text,
  redirect_uri text,
  code_challenge text,
  code_challenge_method text,
  profile_id uuid,
  workspace_id uuid,
  scopes text[],
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.oauth_authorization_codes code
  set consumed_at = now()
  where code.code_hash = p_code_hash
    and code.consumed_at is null
    and code.expires_at > now()
  returning
    code.id,
    code.code_hash,
    code.client_id,
    code.redirect_uri,
    code.code_challenge,
    code.code_challenge_method,
    code.profile_id,
    code.workspace_id,
    code.scopes,
    code.expires_at,
    code.consumed_at,
    code.created_at;
$$;

revoke all on function public.consume_oauth_authorization_code(text) from public;
revoke all on function public.consume_oauth_authorization_code(text) from anon;
revoke all on function public.consume_oauth_authorization_code(text) from authenticated;
revoke all on function public.consume_oauth_authorization_code(text) from mcp_session_executor;
grant execute on function public.consume_oauth_authorization_code(text) to service_role;

create or replace function public.rotate_oauth_refresh_token(
  p_refresh_token_hash text,
  p_new_token_hash text,
  p_new_refresh_token_hash text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
)
returns table (
  id uuid,
  token_hash text,
  refresh_token_hash text,
  client_id text,
  profile_id uuid,
  workspace_id uuid,
  mcp_key_id uuid,
  scopes text[],
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with current_grant as (
    update public.oauth_access_tokens token
    set revoked_at = now()
    where token.refresh_token_hash = p_refresh_token_hash
      and token.refresh_token_hash is not null
      and token.revoked_at is null
      and token.refresh_expires_at > now()
      and exists (
        select 1
        from public.profiles profile
        join public.workspace_members member
          on member.profile_id = profile.id
          and member.workspace_id = token.workspace_id
        join public.mcp_keys mcp_key
          on mcp_key.id = token.mcp_key_id
          and mcp_key.workspace_id = token.workspace_id
        where profile.id = token.profile_id
          and profile.deleted_at is null
          and mcp_key.revoked_at is null
      )
    returning
      token.client_id,
      token.profile_id,
      token.workspace_id,
      token.mcp_key_id,
      token.scopes
  ),
  inserted_token as (
    insert into public.oauth_access_tokens (
      token_hash,
      refresh_token_hash,
      client_id,
      profile_id,
      workspace_id,
      mcp_key_id,
      scopes,
      expires_at,
      refresh_expires_at
    )
    select
      p_new_token_hash,
      p_new_refresh_token_hash,
      current_grant.client_id,
      current_grant.profile_id,
      current_grant.workspace_id,
      current_grant.mcp_key_id,
      current_grant.scopes,
      p_access_expires_at,
      p_refresh_expires_at
    from current_grant
    returning
      oauth_access_tokens.id,
      oauth_access_tokens.token_hash,
      oauth_access_tokens.refresh_token_hash,
      oauth_access_tokens.client_id,
      oauth_access_tokens.profile_id,
      oauth_access_tokens.workspace_id,
      oauth_access_tokens.mcp_key_id,
      oauth_access_tokens.scopes,
      oauth_access_tokens.expires_at,
      oauth_access_tokens.refresh_expires_at,
      oauth_access_tokens.created_at
  )
  select * from inserted_token;
$$;

revoke all on function public.rotate_oauth_refresh_token(
  text,
  text,
  text,
  timestamptz,
  timestamptz
) from public;
revoke all on function public.rotate_oauth_refresh_token(
  text,
  text,
  text,
  timestamptz,
  timestamptz
) from anon;
revoke all on function public.rotate_oauth_refresh_token(
  text,
  text,
  text,
  timestamptz,
  timestamptz
) from authenticated;
revoke all on function public.rotate_oauth_refresh_token(
  text,
  text,
  text,
  timestamptz,
  timestamptz
) from mcp_session_executor;
grant execute on function public.rotate_oauth_refresh_token(
  text,
  text,
  text,
  timestamptz,
  timestamptz
) to service_role;

create or replace function public.verify_oauth_access_token(
  p_token_hash text
)
returns table (
  id uuid,
  client_id text,
  profile_id uuid,
  workspace_id uuid,
  mcp_key_id uuid,
  scopes text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with valid_token as (
    update public.oauth_access_tokens token
    set last_used_at = now()
    where token.token_hash = p_token_hash
      and token.revoked_at is null
      and token.expires_at > now()
      and exists (
        select 1
        from public.profiles profile
        join public.workspace_members member
          on member.profile_id = profile.id
          and member.workspace_id = token.workspace_id
        join public.mcp_keys mcp_key
          on mcp_key.id = token.mcp_key_id
          and mcp_key.workspace_id = token.workspace_id
        where profile.id = token.profile_id
          and profile.deleted_at is null
          and mcp_key.revoked_at is null
      )
    returning
      token.id,
      token.client_id,
      token.profile_id,
      token.workspace_id,
      token.mcp_key_id,
      token.scopes
  ),
  touched_key as (
    update public.mcp_keys mcp_key
    set last_used_at = now()
    from valid_token
    where mcp_key.id = valid_token.mcp_key_id
    returning 1
  )
  select
    valid_token.id,
    valid_token.client_id,
    valid_token.profile_id,
    valid_token.workspace_id,
    valid_token.mcp_key_id,
    valid_token.scopes
  from valid_token;

  if not found then
    with invalid_grant as (
      select
        token.id,
        token.mcp_key_id,
        token.workspace_id
      from public.oauth_access_tokens token
      left join public.profiles profile
        on profile.id = token.profile_id
      left join public.workspace_members member
        on member.profile_id = token.profile_id
        and member.workspace_id = token.workspace_id
      left join public.mcp_keys mcp_key
        on mcp_key.id = token.mcp_key_id
        and mcp_key.workspace_id = token.workspace_id
      where token.token_hash = p_token_hash
        and token.revoked_at is null
        and (
          profile.id is null
          or profile.deleted_at is not null
          or member.id is null
          or mcp_key.id is null
          or mcp_key.revoked_at is not null
        )
    ),
    revoked_tokens as (
      update public.oauth_access_tokens token
      set revoked_at = now()
      from invalid_grant
      where token.id = invalid_grant.id
      returning invalid_grant.mcp_key_id, invalid_grant.workspace_id
    )
    update public.mcp_keys mcp_key
    set revoked_at = coalesce(mcp_key.revoked_at, now())
    from revoked_tokens
    where mcp_key.id = revoked_tokens.mcp_key_id
      and mcp_key.workspace_id = revoked_tokens.workspace_id;
  end if;
end;
$$;

revoke all on function public.verify_oauth_access_token(text) from public;
revoke all on function public.verify_oauth_access_token(text) from anon;
revoke all on function public.verify_oauth_access_token(text) from authenticated;
revoke all on function public.verify_oauth_access_token(text) from mcp_session_executor;
grant execute on function public.verify_oauth_access_token(text) to service_role;
