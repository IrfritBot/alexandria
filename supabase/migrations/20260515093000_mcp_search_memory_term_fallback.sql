-- Improve natural MCP memory search recall while preserving read visibility.

create or replace function public.search_mcp_memories(
  p_workspace_id uuid,
  p_mcp_key_id uuid,
  p_query text,
  p_limit integer default 10,
  p_kind text default null,
  p_tags jsonb default '[]'::jsonb
)
returns table (
  memory_id uuid,
  content text,
  kind text,
  tags jsonb,
  author_label text,
  source text,
  source_client text,
  created_at timestamptz,
  relevance_score numeric,
  total_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_limit integer := coalesce(p_limit, 10);
  v_tags jsonb := coalesce(p_tags, '[]'::jsonb);
  v_tsquery tsquery;
begin
  if p_workspace_id is null or p_mcp_key_id is null then
    raise exception 'invalid_input:session' using errcode = '22023';
  end if;

  if length(v_query) = 0 then
    raise exception 'invalid_input:query' using errcode = '22023';
  end if;

  if v_limit < 1 then
    raise exception 'invalid_input:limit' using errcode = '22023';
  end if;

  v_limit := least(v_limit, 50);

  if p_kind is not null and p_kind not in ('policy', 'fact', 'judgment') then
    raise exception 'invalid_input:kind' using errcode = '22023';
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

  v_tsquery := websearch_to_tsquery('english'::regconfig, v_query);

  return query
  with requested_tags as (
    select distinct tag.name
    from jsonb_array_elements_text(v_tags) as tag(name)
  ),
  requested_tag_count as (
    select count(*)::integer as value
    from requested_tags
  ),
  raw_query_terms as (
    select distinct lower(raw.term_match[1]) as term
    from regexp_matches(v_query, '[[:alnum:]]{3,}', 'g') as raw(term_match)
  ),
  meaningful_query_terms as (
    select q.term, q.term_tsquery
    from (
      select
        rqt.term,
        plainto_tsquery('english'::regconfig, rqt.term) as term_tsquery
      from raw_query_terms rqt
    ) q
    where numnode(q.term_tsquery) > 0
  ),
  candidates as (
    select
      m.id,
      m.content,
      m.kind,
      m.author_profile_id,
      m.metadata,
      m.created_at,
      m.updated_at,
      ts_rank_cd(m.search_document, v_tsquery) as lexical_rank,
      case
        when m.content ilike ('%' || v_query || '%')
          or coalesce(m.title, '') ilike ('%' || v_query || '%')
          then 0.25
        else 0
      end as substring_rank,
      (
        m.search_document @@ v_tsquery
        or m.content ilike ('%' || v_query || '%')
        or coalesce(m.title, '') ilike ('%' || v_query || '%')
        or strict_tag_match.value
      ) as strict_match,
      fallback_term_match.rank as fallback_rank
    from public.memories m
    cross join requested_tag_count rtc
    cross join lateral (
      select exists (
        select 1
        from public.memory_tags mt
        join public.workspace_tags wt
          on wt.workspace_id = mt.workspace_id
         and wt.id = mt.workspace_tag_id
        where mt.workspace_id = m.workspace_id
          and mt.memory_id = m.id
          and mt.deleted_at is null
          and wt.deleted_at is null
          and wt.name ilike ('%' || v_query || '%')
      ) as value
    ) strict_tag_match
    cross join lateral (
      select coalesce(
        sum(
          case
            when m.search_document @@ qt.term_tsquery
              then greatest(
                ts_rank_cd(m.search_document, qt.term_tsquery)::numeric,
                0.04::numeric
              )
            else 0::numeric
          end
          + case
            when m.content ilike ('%' || qt.term || '%')
              then 0.02::numeric
            else 0::numeric
          end
          + case
            when coalesce(m.title, '') ilike ('%' || qt.term || '%')
              then 0.03::numeric
            else 0::numeric
          end
          + case
            when exists (
              select 1
              from public.memory_tags mt
              join public.workspace_tags wt
                on wt.workspace_id = mt.workspace_id
               and wt.id = mt.workspace_tag_id
              where mt.workspace_id = m.workspace_id
                and mt.memory_id = m.id
                and mt.deleted_at is null
                and wt.deleted_at is null
                and wt.name ilike ('%' || qt.term || '%')
            ) then 0.03::numeric
            else 0::numeric
          end
        ),
        0::numeric
      ) as rank
      from meaningful_query_terms qt
    ) fallback_term_match
    where m.workspace_id = p_workspace_id
      and public.is_mcp_read_visible_memory(m.workspace_id, m.id, m.status)
      and m.deleted_at is null
      and m.superseded_by_memory_id is null
      and (p_kind is null or m.kind = p_kind)
      and (
        rtc.value = 0
        or (
          select count(distinct rt.name)
          from requested_tags rt
          where exists (
            select 1
            from public.memory_tags mt
            join public.workspace_tags wt
              on wt.workspace_id = mt.workspace_id
             and wt.id = mt.workspace_tag_id
            where mt.workspace_id = m.workspace_id
              and mt.memory_id = m.id
              and mt.deleted_at is null
              and wt.deleted_at is null
              and wt.name = rt.name
          )
        ) = rtc.value
      )
      and (
        m.search_document @@ v_tsquery
        or m.content ilike ('%' || v_query || '%')
        or coalesce(m.title, '') ilike ('%' || v_query || '%')
        or strict_tag_match.value
        or fallback_term_match.rank > 0
      )
  ),
  ranked as (
    select
      c.*,
      case
        when c.strict_match then least(
          1::numeric,
          greatest(
            0.01::numeric,
            (c.lexical_rank + c.substring_rank)::numeric
          )
        )
        else least(
          0.009::numeric,
          greatest(0.001::numeric, c.fallback_rank)
        )
      end as score,
      count(*) over ()::integer as total
    from candidates c
  )
  select
    r.id as memory_id,
    r.content,
    r.kind,
    coalesce(memory_tag_list.tags, '[]'::jsonb) as tags,
    coalesce(
      nullif(btrim(r.metadata ->> 'author_label'), ''),
      nullif(btrim(r.metadata ->> 'source_client'), ''),
      case
        when r.author_profile_id is not null then 'Workspace member'
        else 'MCP key'
      end
    ) as author_label,
    case
      when r.metadata ->> 'source' in ('mcp', 'web_ui', 'import')
        then r.metadata ->> 'source'
      when r.metadata ->> 'source' in ('web', 'manual')
        then 'web_ui'
      when r.author_profile_id is not null
        then 'web_ui'
      else 'mcp'
    end as source,
    nullif(btrim(r.metadata ->> 'source_client'), '') as source_client,
    r.created_at,
    r.score as relevance_score,
    r.total as total_count
  from ranked r
  left join lateral (
    select jsonb_agg(wt.name order by wt.name) as tags
    from public.memory_tags mt
    join public.workspace_tags wt
      on wt.workspace_id = mt.workspace_id
     and wt.id = mt.workspace_tag_id
    where mt.workspace_id = p_workspace_id
      and mt.memory_id = r.id
      and mt.deleted_at is null
      and wt.deleted_at is null
  ) memory_tag_list on true
  order by r.strict_match desc, r.score desc, r.updated_at desc
  limit v_limit;
end;
$$;

revoke all on function public.search_mcp_memories(uuid, uuid, text, integer, text, jsonb) from public;
revoke all on function public.search_mcp_memories(uuid, uuid, text, integer, text, jsonb) from anon;
revoke all on function public.search_mcp_memories(uuid, uuid, text, integer, text, jsonb) from authenticated;
revoke all on function public.search_mcp_memories(uuid, uuid, text, integer, text, jsonb) from service_role;
grant execute on function public.search_mcp_memories(uuid, uuid, text, integer, text, jsonb) to mcp_session_executor;
