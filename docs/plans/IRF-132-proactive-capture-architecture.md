# IRF-132: Alexandria Proactive Capture Architecture Plan

**Goal:** Make Alexandria feel more proactive at capturing durable facts without requiring users to say "using Alexandria" every time.

**Architecture:** Do not build a hidden passive listener. MCP servers do not automatically receive every client prompt, and the spec intentionally puts data sharing, tool calls, and sampling under client/user control. The right v1 path is a layered capture system: stronger server/tool hints, paste-ready client rules, optional MCP prompts/resources for clients that support them, and consent-safe save heuristics. These are advisory signals, not enforcement; they improve client behavior but cannot force a host/model to capture proactively.

**Constraints:**
- DO NOT attempt background transcript ingestion without explicit user/workspace opt-in.
- DO NOT assume Alexandria can inspect arbitrary client conversations through MCP.
- DO NOT save sensitive personal data or speculation by default.
- DO NOT weaken governance: saved facts still go through classification, conflict detection, audit, and review.
- DO NOT add a new database table in this slice unless the architecture brief proves it is necessary.
- DO NOT break the existing `memory_save`, `memory_search`, `memory_recall_recent`, or `memory_get` contracts.

---

## Task 1: Write the proactive capture architecture brief

**Files:**
- Create: `docs/briefs/2026-05-26-proactive-capture-architecture.md`

**Steps:**
- [ ] Document the core product take: Alexandria cannot and should not silently listen as an MCP server.
- [ ] Compare four capture layers:
  - Tool descriptions and server instructions.
  - Client setup rules for Claude, Cursor, Codex, and ChatGPT-style clients.
  - MCP prompts/resources where clients support them.
  - Future explicit transcript/batch ingest with workspace opt-in.
- [ ] Define "save automatically", "ask before saving", and "ignore" heuristics.
- [ ] Define privacy boundaries for personal, speculative, sensitive, and external-customer data.
- [ ] State that tool descriptions, annotations, prompts, and setup rules are advisory and client-dependent; Alexandria cannot guarantee proactive behavior unless the client/agent follows the policy.
- [ ] Include references to MCP consent/control constraints and Supabase/Alexandria governance assumptions.

**Expected behavior:** The repo has a short source-of-truth brief explaining the proactive model before code changes are made.

---

## Task 2: Strengthen MCP tool descriptions and annotations

**Files:**
- Modify: `src/lib/mcp/tool-descriptions.ts`
- Update: `src/app/api/mcp/route.test.ts`

**Steps:**
- [ ] Rewrite `MEMORY_SAVE_DESCRIPTION` around concrete trigger heuristics:
  - Durable customer/client/vendor facts.
  - Decisions, policies, constraints, preferences, and project history.
  - Stable operational details that would help a future teammate or agent.
- [ ] Add "ask first" cases:
  - Ambiguous personal info.
  - Private/sensitive facts.
  - Speculation, brainstorming, or unvalidated claims.
- [ ] Add "do not save" cases:
  - Current-task scratchpad.
  - One-off instructions.
  - Secrets, tokens, credentials, or private medical/legal/financial data.
- [ ] Add MCP tool annotations to the tool definition type and tool list:
  - `memory_search`, `memory_get`, `memory_recall_recent`: read-only, idempotent.
  - `memory_save`: not read-only, not idempotent, not destructive.
- [ ] Update tests to assert descriptions include proactive triggers and annotations are present.
- [ ] Add tests asserting the description includes "ask first" boundaries and "do not save" boundaries for sensitive data, speculation, scratchpad content, and secrets.

**Expected behavior:** Models get stronger hints for when to save/search, and clients that surface annotations can show safer tool affordances.

---

## Task 3: Add MCP server instructions to handshake

**Files:**
- Modify: `src/app/api/mcp/route.ts`
- Update: `src/app/api/mcp/route.test.ts`
- Modify: `src/lib/mcp/tool-descriptions.ts`

**Steps:**
- [ ] Export a compact `MCP_SERVER_INSTRUCTIONS` string from `tool-descriptions.ts`.
- [ ] Include it in the JSON-RPC `initialize` result as `instructions`.
- [ ] Keep protocol version negotiation unchanged.
- [ ] Test that `initialize` returns instructions and still returns the current server info/capabilities.

**Expected behavior:** MCP clients that inject server instructions into model context get a better baseline memory policy without users manually mentioning Alexandria.

---

## Task 4: Add client setup policy blocks

**Files:**
- Create: `src/lib/mcp/client-setup-policy.ts`
- Create: `src/lib/mcp/client-setup-policy.test.ts`
- Create: `src/app/workspaces/[slug]/setup/page.tsx`
- Update: `src/app/workspaces/[slug]/_components/workspace-shell.tsx`
- Update: `src/app/workspaces/governance-shell.test.ts`

**Steps:**
- [ ] Create copy blocks for common client rule systems:
  - Claude Project/custom instructions.
  - Cursor rules.
  - Codex/agent instructions.
  - Generic MCP client prompt.
- [ ] Each block should tell the client to search at conversation start when a project/client/topic is mentioned and to save durable facts proactively under the Task 2 heuristics.
- [ ] Render a member-safe workspace setup page with the policy blocks and OAuth remote MCP connection details.
- [ ] Do not show manual `alex_*` API key creation instructions or one-time key material on this page; those remain admin-only under `/workspaces/[slug]/keys`.
- [ ] Add the setup page to workspace navigation.
- [ ] Test that the setup page is membership-gated, includes all expected client names, and does not expose admin-only key creation/copy.

**Expected behavior:** Teams can install the proactive behavior into the client layer, where the conversation context actually lives.

---

## Task 5: Optional MCP prompts support

**Files:**
- Modify: `src/app/api/mcp/route.ts`
- Update: `src/app/api/mcp/route.test.ts`
- Modify: `src/lib/mcp/tool-descriptions.ts`

**Steps:**
- [ ] Add `prompts` capability to `initialize` only if implementing `prompts/list` and `prompts/get` in the same slice.
- [ ] Implement `prompts/list` with:
  - `alexandria_memory_policy`
  - `alexandria_session_start`
  - `alexandria_save_candidate`
- [ ] Implement `prompts/get` to return short prompt messages that clients/users can explicitly invoke.
- [ ] Keep the feature additive; clients without prompt support continue using tools normally.
- [ ] Add JSON-RPC tests for list/get and unknown prompt errors.

**Expected behavior:** Clients that support MCP prompts can pull Alexandria's memory policy deliberately without custom copy/paste setup.

---

## Task 6: Verification

**Files:**
- Update: tests touched above

**Steps:**
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run demo:check` if a valid local or production demo key/token is configured.
- [ ] Deterministically verify JSON-RPC `initialize` returns `instructions` with proactive capture language.
- [ ] Deterministically verify `tools/list` returns annotations for all memory tools.
- [ ] Deterministically verify tool descriptions include proactive triggers, "ask first" cases, "do not save" cases, and no requirement that users say "using Alexandria".
- [ ] Deterministically verify the setup page is member-gated, contains client policy blocks, and omits manual API-key creation details for non-admin setup.

**Expected behavior:** Proactive capture changes are additive, tested, and do not regress existing MCP smoke behavior.

---

## Recommendation

Ship Tasks 1-4 first. Task 5 is useful but secondary because MCP tool descriptions and setup rules are more broadly supported than prompts across clients today.
