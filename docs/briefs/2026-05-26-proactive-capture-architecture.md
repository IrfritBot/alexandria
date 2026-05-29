# Proactive Capture Architecture

Date: 2026-05-26

Alexandria should feel proactive about durable team memory, but it cannot and
should not silently listen to every conversation as an MCP server. MCP keeps the
host/client in control of context sharing, authorization, prompts, and tool
calls. Alexandria only sees data the client or user chooses to send to its tools
or prompt/resource surfaces.

The v1 architecture is a layered advisory system:

1. **Tool descriptions and server instructions.** `memory_search` tells clients
   to search when a conversation starts around a known client, project, vendor,
   process, or topic. `memory_save` gives concrete save/ask/ignore heuristics.
   Tool annotations mark read tools as read-only and idempotent, while
   `memory_save` is additive but not idempotent.
2. **Client setup rules.** Workspace members can copy policy blocks into Claude
   Project instructions, Cursor rules, Codex/agent instructions, or a generic
   MCP client system prompt. This is where proactive behavior is most practical,
   because the client has the conversation context.
3. **Optional MCP prompts.** Clients that support MCP prompts can explicitly
   list and invoke Alexandria memory policy prompts instead of relying only on
   pasted setup text. Prompt support remains additive; tools continue to work
   for clients that ignore prompts.
4. **Future explicit transcript or batch ingest.** Full transcript capture, if
   ever added, must be an explicit workspace opt-in flow with clear consent,
   scoping, retention, redaction, and review controls. It should not be hidden
   passive listening.

## Save Policy

**Save automatically** when the user shares durable work context that would help
a future teammate or agent:

- Customer, client, vendor, or partner facts that are stable and work-relevant.
- Decisions, policies, constraints, preferences, and project history.
- Stable operational details such as renewal dates, technical stack choices,
  ownership, rollout plans, recurring process rules, and support expectations.
- Direct requests such as "remember this", "save this", or "log this".

**Ask before saving** when the candidate memory includes:

- Ambiguous personal information, even if work-adjacent.
- Private or sensitive facts.
- External-customer details that may be confidential.
- Speculation, brainstorming, hypotheses, or unvalidated claims.
- Anything the user may expect to remain only in the current conversation.

**Ignore by default** and do not save:

- Current-task scratchpad, drafts, temporary reasoning, or intermediate notes.
- One-off instructions and ephemeral formatting preferences.
- Secrets, tokens, credentials, private keys, session cookies, or recovery
  codes.
- Private medical, legal, financial, or other sensitive personal data.

## Privacy And Governance

The proactive policy must not weaken governance. Saved memories still use the
existing `memory_save` path, classification, conflict detection, audit logging,
and admin review. The policy also must not save sensitive, speculative, or
private data by default. When a client is uncertain, it should ask the user
before calling `memory_save`.

Tool descriptions, annotations, server instructions, prompts, and pasted setup
rules are all hints. They improve client/model behavior, but Alexandria cannot
guarantee proactive capture unless the host, client, and model follow the
policy. Alexandria also cannot inspect arbitrary client conversations through
MCP without the client sending that context.

References:

- [MCP 2025-06-18 architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture):
  host/client control, authorization decisions, and server capabilities.
- [MCP 2025-06-18 schema](https://modelcontextprotocol.io/specification/2025-06-18/schema):
  tool annotations are hints, including `readOnlyHint`, `destructiveHint`, and
  `idempotentHint`.
- [MCP 2025-06-18 prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts):
  prompts are user-controlled templates that servers can expose to clients.
- [Alexandria OAuth MCP connector brief](./2026-05-07-oauth-mcp-connector.md):
  remote MCP OAuth uses narrow `memory:read` and `memory:write` scopes and keeps
  existing MCP RLS/RPC behavior in place.
- [Alexandria README](../../README.md): saved memories run through asynchronous
  classification, conflict detection, audit, and review behavior.
