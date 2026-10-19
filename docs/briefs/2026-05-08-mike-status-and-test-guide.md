# Alexandria — Current Status + Mike Test Guide

_Date: 2026-05-08_  
_Audience: Mike / MCHO cofounder feedback_

## Short version

Alexandria is a shared memory layer for teams using AI.

Instead of every teammate re-explaining company context to Claude, Cursor, ChatGPT, or future agents, Alexandria gives a team one governed memory workspace that AI tools can read from and write to through MCP.

We have a live first version ready for cofounder/design-partner feedback. This is **not a polished public launch** yet. The goal is to validate whether the core workflow is useful enough for MCHO to keep building around it.

Production URL: https://alexandria-sage.vercel.app

## What works today

### 1. Sign in + workspace setup

- Email sign-in is live.
- A user can create a workspace, for example `MCHO`.
- Workspaces keep team memory separated from other companies/teams.

### 2. Shared team memories

Alexandria can store useful team context such as:

- company decisions,
- product direction,
- customer/project context,
- team preferences,
- operating rules,
- project history,
- notes that should be available to AI tools later.

### 3. MCP memory tools

The MCP/API layer supports the core memory loop:

- `memory_save` — save new team memory.
- `memory_search` — search existing memory.
- `memory_get` — fetch one memory by ID.
- `memory_recall_recent` — pull recent memories for context.

### 4. OAuth remote MCP connector

- The preferred connector path is OAuth, not manual key-pasting.
- An OAuth-capable MCP client can connect to Alexandria, open browser login/consent, and receive scoped Alexandria tokens.
- Manual MCP API keys still exist, but they are mainly for fallback, service accounts, and dev/API smoke tests.

### 5. Processing + governance foundation

When a memory is saved, Alexandria can process it for:

- memory type/classification,
- search indexing,
- conflict/duplicate detection,
- audit/history.

### 6. Basic web governance shell

The web app has basic pages for:

- memories,
- conflicts,
- audit,
- usage,
- connector/API-key management.

This UI is intentionally simple right now. The point is not to replace Notion. The point is to make AI-visible team memory inspectable and governable.

## What is still MVP / not polished yet

- The governance UI is basic.
- Invite/member management is not polished.
- Search works, but we still want stronger hybrid semantic search.
- OAuth MCP setup may still need polish depending on the client.
- Conflict resolution actions are not fully productized yet.

## How to test

### Step 1 — Open the app

Go to:

https://alexandria-sage.vercel.app

Then sign in with email.

### Step 2 — Create an MCHO test workspace

Suggested workspace:

- Name: `MCHO`
- Slug: `mcho`
- Purpose: `Shared AI memory workspace for MCHO company context, product decisions, operating notes, and customer discovery.`

### Step 3 — Connect through OAuth MCP

Use an OAuth-capable MCP client and add Alexandria as a remote MCP server/resource:

`https://alexandria-sage.vercel.app/api/mcp`

Expected flow:

1. The client discovers Alexandria’s OAuth metadata.
2. Alexandria opens browser sign-in/consent.
3. Mike signs in with email.
4. Mike chooses the MCHO workspace and approves memory read/write scopes.
5. The client can use Alexandria’s memory tools without Mike copying an API key.

If the client does not support this OAuth flow yet, Henry can run a manual API-key smoke test behind the scenes. That is fallback/dev behavior, not the main partner onboarding path.

### Step 4 — Save a few simple test memories

Once connected through OAuth MCP, ask the AI client to save a few simple memories.

Good first examples:

1. `MCHO is testing Alexandria as a shared AI memory layer for team workflows.`
2. `For this test, only save non-sensitive MCHO operating context. Do not save secrets or private customer data.`
3. `The first Alexandria test should focus on sign-in, workspace setup, OAuth MCP connection, memory save/search/get, and whether the governance shell feels useful.`

Suggested tags:

- `mcho/product`
- `ai-memory`
- `cofounder-feedback`

### Step 5 — Search for those memories

Ask the AI client to search Alexandria for:

- `MCHO test focus`
- `non-sensitive operating context`
- `shared AI memory layer`

The goal is to see whether saved team context can be retrieved later in a useful way.

### Step 6 — Inspect the web shell

Look at:

- Memories — what was saved?
- Conflicts — did anything need review?
- Audit — can we tell what happened?
- Usage — does the activity make sense?
- Connector/API-key management — does the access model feel understandable?

## Feedback we want from Mike

The most useful feedback is product feedback from a cofounder/partner, not bug-by-bug QA.

Questions:

1. Does this problem feel real for the kinds of teams MCHO wants to serve?
2. What company/product/customer context would you actually want AI tools to remember?
3. Would this be useful inside Claude Team, Cursor, or similar AI workflows?
4. What should be saved automatically vs manually approved?
5. What would make the governance shell trustworthy enough for a team?
6. Does OAuth MCP onboarding feel acceptable, or does connection setup need to be much simpler?
7. What would make this valuable enough for us to keep building and testing with real users?

## Suggested testing mindset

Treat this like a cofounder product walkthrough.

We are not trying to prove the product is finished. We are trying to learn whether the core loop is valuable:

**save useful team context once → govern it → retrieve it from AI tools later.**
