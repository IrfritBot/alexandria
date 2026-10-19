# Alexandria — Product Feature Brief for Mike

_Date: 2026-05-04_  
_Audience: Mike / funding conversations_  
_Tone: transparent, accurate, lightly technical. This is raw material, not sales copy._

## 1. Short version

Alexandria is a shared memory layer for teams using AI tools.

Instead of every person re-explaining company context to Claude, Cursor, ChatGPT, or future AI agents, Alexandria gives the team one governed memory workspace that AI clients can read from and write to through MCP.

The important product opinion: **Alexandria is not trying to be another chat assistant.** The user already has an LLM. Alexandria is the memory substrate underneath those LLMs: capture useful team context once, govern it, and retrieve it wherever the team works.

## 2. Problem we are solving

Teams adopting AI are running into a new kind of knowledge-management problem:

1. **Repeated context tax**  
   Every AI session starts cold. People paste the same decisions, customer notes, style guides, policies, and project history into prompts again and again.

2. **Fragmented AI memory**  
   One teammate teaches Claude one version of the company. Another teaches Cursor something different. Important context ends up scattered across chats, Notion, Slack, personal files, and undocumented prompt habits.

3. **No governance for AI-visible knowledge**  
   If a team lets AI tools remember things, someone needs to know what was saved, who saved it, whether it conflicts with older knowledge, and what should be trusted.

Our research and product discussions suggest a gap between personal AI memory tools and enterprise search. Notion AI, Glean, mem.ai, local memory files, and ad-hoc RAG systems each solve pieces of the problem, but there is room for an MCP-native, model-agnostic, multi-user shared memory product aimed at 20–200 person teams.

## 3. First target customer

Initial ICP: **20–200 person SMB teams that already use AI heavily**, especially:

- agencies,
- marketing teams,
- product teams,
- SaaS teams,
- AI-heavy operators.

The first design-partner shape is WMM: a 20–50 person agency using a Claude Team org. That is useful because the pain is practical, not theoretical: client context, positioning, preferences, decisions, and project history need to travel across people and AI tools.

Non-ICP for v1:

- solo users,
- large enterprise procurement-heavy teams,
- companies not yet using AI in daily workflows,
- teams looking for a full Notion replacement.

## 4. MVP product shape

The MVP is a governed shared-memory system with two surfaces:

1. **MCP server for AI clients**  
   This is the main product surface. Claude Desktop, Cursor, and other MCP-capable tools can connect to Alexandria and use team memory during normal work.

2. **Web governance shell for humans**  
   A lightweight Notion-like browser where humans can inspect memory, manage API keys, review conflicts, and see audit/history.

The MVP is intentionally not a giant knowledge platform. It is the smallest credible version of: **save useful team memory, retrieve it from AI tools, and keep it trustworthy.**

## 5. MVP features

### A. Workspace-based team memory

Each company/team gets a workspace. Memories belong to that workspace and are isolated from other workspaces.

A memory can be a decision, policy, customer detail, project update, preference, or useful operational context.

Examples:

- “Enterprise pricing remains annual-first unless approved by an admin.”
- “Client X prefers concise weekly updates with screenshots.”
- “For this product, we use Supabase RLS as defense-in-depth, not just route-handler checks.”

### B. MCP tools for AI clients

The v1 MCP surface is deliberately small:

- `memory_save` — save a new memory.
- `memory_search` — search workspace memory.
- `memory_recall_recent` — pull recent memory for context bootstrap.
- `memory_get` — fetch a specific memory by ID.

There are **no destructive MCP tools in v1**. AI clients cannot delete, update, resolve conflicts, or perform admin actions. That is intentional: shared team knowledge should not be destructively modified by an LLM without a human review surface.

### C. Human auth + MCP API keys

Humans sign in through Supabase magic-link auth.

MCP clients use workspace-scoped API keys. Keys are designed so they belong to one workspace only, can be revoked, and do not expose raw secrets after creation.

This lets a team connect different AI clients while still keeping access bounded to the correct workspace.

### D. Async memory processing pipeline

When a memory is saved, the API returns quickly with a `memory_id`. More expensive processing happens in the background:

1. classify the memory,
2. generate embeddings,
3. detect likely duplicates/conflicts,
4. write revision/audit records,
5. mark the memory active or route it to review.

This keeps the AI client UX fast while still allowing more serious governance work in the background.

### E. Memory classification

Alexandria classifies memories by kind:

- **policy** — rules, decisions, official stances,
- **fact** — verifiable claims,
- **judgment** — opinions, prioritization, interpretations,
- **unknown** — classifier failure or uncertain cases.

This matters because different memory types should resolve conflicts differently. A policy conflict is not the same as two opinions disagreeing.

### F. Conflict detection and review

The MVP design includes conflict detection so shared memory does not become an untrusted pile of stale facts.

The system checks for similar existing memories. Depending on type and confidence:

- obvious duplicates can be superseded,
- some policy/fact conflicts can be auto-resolved by rules,
- ambiguous judgments or unknown cases go to admin review.

The web shell gives admins visibility into conflicts. The full conflict-resolution workflow is an important near-term follow-up; the current MVP shell is more inspection/review-oriented than a mature governance console.

### G. Audit and revision history

The system records memory events and workspace events separately.

This is important for trust. Teams should be able to answer:

- who saved this,
- when it changed,
- which memory superseded which,
- which key/client wrote it,
- what admin action happened.

### H. Basic web governance shell

The current web UI includes:

- authenticated workspace shell,
- memory browse/search/detail pages,
- MCP key create/list/revoke,
- conflict queue visibility,
- audit/usage shell,
- member/admin role boundary.

It is not trying to be a full document editor. The job of the web UI is governance, not replacing the AI client.

### I. Landing page and production deployment

The public landing page is live at:

https://alexandria-sage.vercel.app

It explains the product as: **“One memory layer for every AI your team uses.”**

## 6. Current implementation status — transparent version

What is implemented and verified in code:

- Next.js app + API route foundation.
- Supabase schema with workspace-scoped tables and RLS strategy.
- Auth foundation and workspace bootstrap.
- MCP key lifecycle.
- `memory_save` path.
- Worker v1 for classify/embed/conflict/finalize.
- MCP memory tools.
- Minimal web governance shell.
- Production deployment to Vercel.
- Public landing page.
- Automated tests/build passing locally and in production build.

Important caveats:

- The production app is deployed and smoke-tested, but full production end-to-end memory processing still needs final environment wiring for MCP executor/Inngest secrets and worker registration before we should call the live write pipeline fully production-green.
- Search currently has a pragmatic implementation; the intended full hybrid search path is keyword + vector + rerank. This should be upgraded before relying on search quality heavily in customer demos.
- The MCP endpoint is implemented for the MVP path, but external-client protocol polish/compliance should be tightened before onboarding many real external clients.
- The governance shell is intentionally minimal. Rich conflict resolution, tag curation, member invites, pagination, and better admin workflows are follow-up work.

In short: **the MVP architecture and core flows are built, the landing/web shell are live, and the remaining work is hardening the production-grade customer loop.**

## 7. Beyond MVP roadmap

### Near-term hardening

These are the features needed to make the product safer for real design-partner usage:

- finish production Inngest/MCP executor env setup,
- run live end-to-end MCP write/read demo checks,
- upgrade search to true hybrid semantic retrieval,
- tighten MCP protocol compliance for real client onboarding,
- add richer admin conflict-resolution actions,
- add member invite/management polish,
- improve stuck-processing and worker-failure visibility.

### Better memory capture

Future versions should support three capture modes:

1. **Explicit save** — user says “remember this.”
2. **Suggested save** — AI notices durable context and asks permission to save.
3. **Ambient save** — optional background capture for teams that accept more noise in exchange for stronger recall.

Ambient capture should be off by default. It only works if governance, audit, and review tools are strong enough.

### Stronger governance

Likely roadmap:

- richer conflict queue,
- merge/keep/delete workflows,
- admin review digests,
- tag curation,
- memory quality scoring,
- source confidence,
- retention controls,
- better audit exports.

This is where Alexandria becomes more than “RAG over notes.” The product wins if teams trust the memory enough to let AI use it.

### Better retrieval and context injection

The retrieval roadmap:

- hybrid keyword + vector search,
- LLM reranking,
- workspace-specific tag/context boosts,
- “recall recent decisions” flows,
- better provenance snippets,
- client-specific context bundles.

The goal is not just search results. The goal is giving an AI client the right team context at the right time.

### Integrations

Potential integrations:

- Claude Desktop,
- Cursor,
- ChatGPT if/when arbitrary MCP support becomes practical,
- Slack import/capture,
- Notion import/capture,
- Linear/GitHub/project management context,
- browser extension or lightweight capture widget.

MCP remains the center. Other integrations are either sources of memory or places where retrieved memory becomes useful.

### Commercial tiers

The architecture supports at least two future tiers:

- **Basic** — cheaper/faster processing with simpler conflict detection.
- **Pro** — stronger classification, better embeddings, and LLM-judged conflict checks.

Billing is not built in v1. Stripe/pricing should wait until we see real usage patterns and cost per workspace.

### Enterprise/security later

Deferred until demand is real:

- SSO/SAML,
- SCIM,
- SOC2 prep,
- workspace-level retention policies,
- IP allowlists,
- advanced permissions,
- self-hosted or private-cloud deployment.

These are not v1 because they would slow down learning with the first SMB/design-partner segment.

## 8. Technical architecture in plain English

- **Frontend/backend:** Next.js on Vercel.
- **Database/auth:** Supabase Postgres + Supabase Auth.
- **Vector search:** pgvector inside Postgres.
- **Background jobs:** Inngest.
- **Classification:** Anthropic models.
- **Embeddings:** OpenAI basic path; Voyage considered for higher-quality/pro tier.
- **Multi-tenancy:** every tenant-owned row has `workspace_id`; RLS is used as defense-in-depth.
- **MCP access:** API keys map each AI client request to exactly one workspace.

The technical bet is that shared memory should be a SaaS product with strong tenant boundaries and governance from day one, not a local folder of markdown files or a single-user memory hack.

## 9. Differentiation / why this is not just Notion or Glean

Alexandria is different because it is:

- **MCP-native** — designed for AI clients and agents, not just human document browsing.
- **Model-agnostic** — works under Claude, Cursor, ChatGPT, or future MCP clients instead of being tied to one assistant.
- **Team-first** — memory belongs to a workspace, not a single user.
- **Governed** — classification, conflicts, audit, roles, and admin review are core, not add-ons.
- **SMB-focused** — avoids enterprise search complexity and solo-user memory limitations.

This is the honest wedge: not “we replace all knowledge management,” but “we make AI-usable team memory trustworthy and portable.”

## 10. Open questions / risks

These should stay visible in funding conversations:

- Will SMB teams adopt MCP soon enough, or do we need more non-MCP capture surfaces early?
- How much governance do teams actually want versus how much they say they want?
- Is the first wedge agencies, product teams, or AI-heavy internal ops teams?
- What is the right pricing unit: seats, workspace, memories, usage, or tiered bundles?
- Can we keep retrieval quality high enough without making per-write/per-search costs painful?
- How much onboarding help is required for non-technical teams to connect MCP clients?
- Does “shared memory” become a platform category, or does it get absorbed by AI clients themselves?

## 11. Investor-safe wording

Good transparent phrasing:

> Alexandria is building a governed shared memory layer for teams using multiple AI tools. The MVP connects through MCP, stores workspace-scoped memories, and gives admins visibility into conflicts, audit, and access. The first wedge is SMB teams already feeling AI context fragmentation, starting with agency-shaped teams.

Avoid overclaiming:

- Do not say it has product-market fit yet.
- Do not say it replaces Notion or Glean.
- Do not say production is fully customer-ready until the live write-processing path is finalized.
- Do not imply enterprise security/compliance is already done.
- Do not oversell ChatGPT support until arbitrary MCP support is practical.

## 12. Best current one-liner

**Alexandria gives every AI tool your team uses the same governed memory, so context stops resetting between people, projects, and clients.**
