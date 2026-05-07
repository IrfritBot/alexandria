# Alexandria — Mike Test Plan

_Date: 2026-05-07_
_Audience: Mike / first design-partner test_
_Status: Draft until production smoke passes._

## What we want Mike to test today

This is not a polished public launch. The goal is to validate the core loop:

1. Sign in to Alexandria.
2. Create a workspace.
3. Create an MCP key.
4. Save a few pieces of team memory.
5. Search and retrieve those memories.
6. Inspect the web shell: memories, conflicts, audit, usage, MCP keys.

## Test URL

Production app:

https://alexandria-sage.vercel.app

## Suggested workspace

- Name: `Web My Money`
- Slug: `web-my-money`
- Context: `Shared AI memory workspace for WMM client/project context, decisions, preferences, and operating notes.`

## Suggested first memories

Use real-ish but non-sensitive examples first:

1. `WMM is the first Alexandria design-partner test workspace for validating team memory workflows.`
2. `For this test, save only non-sensitive WMM operating context; do not save client secrets or private customer data.`
3. `Today’s Alexandria test focus is sign-in, workspace creation, MCP key creation, memory save/search/get, and the web governance shell.`

Suggested tags:

- `wmm/process`
- `client-onboarding`
- `ai-memory`

## Manual API smoke commands

After creating an MCP key in `/workspaces/web-my-money/keys`, export it locally:

```bash
export ALEXANDRIA_MCP_KEY='alex_...'
export ALEXANDRIA_URL='https://alexandria-sage.vercel.app/api/mcp'
```

List tools:

```bash
curl -s "$ALEXANDRIA_URL" \
  -H "Authorization: Bearer $ALEXANDRIA_MCP_KEY" | jq
```

Save memory:

```bash
curl -s "$ALEXANDRIA_URL" \
  -H "Authorization: Bearer $ALEXANDRIA_MCP_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "method": "memory_save",
    "params": {
      "content": "WMM is the first Alexandria design-partner test workspace for validating team memory workflows.",
      "tags": ["wmm/process", "ai-memory"]
    }
  }' | jq
```

Search memory:

```bash
curl -s "$ALEXANDRIA_URL" \
  -H "Authorization: Bearer $ALEXANDRIA_MCP_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "method": "memory_search",
    "params": {
      "query": "concrete visual actionable AI outputs",
      "limit": 5
    }
  }' | jq
```

## What feedback we want

- Does the problem feel real for WMM?
- Would this be useful inside Claude Team / Cursor workflows?
- What memory should be automatic vs manually approved?
- What would make the governance shell trustworthy enough for a team?
- What client/project context would WMM actually save first?
- Is MCP setup acceptable, or does onboarding need to be much simpler?

## Known MVP caveats

- The web shell is intentionally minimal.
- Invite/member management is not polished yet.
- Search is still pragmatic; full hybrid vector + rerank is next.
- External MCP client compatibility may need more protocol hardening; today’s safest test path is the web + API loop unless full MCP smoke passes.
