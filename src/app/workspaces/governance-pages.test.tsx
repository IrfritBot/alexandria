import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../../lib/supabase/server";
import AuditPage from "./[slug]/audit/page";
import ConflictsPage from "./[slug]/conflicts/page";
import MemoryDetailPage from "./[slug]/memories/[memoryId]/page";
import MemoriesPage from "./[slug]/memories/page";
import UsagePage from "./[slug]/usage/page";

vi.mock("server-only", () => ({}));

vi.mock("../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

type Row = Record<string, unknown>;
type TableRows = Partial<Record<string, Row[]>>;
type Filter =
  | {
      column: string;
      op: "eq";
      value: unknown;
    }
  | {
      column: string;
      op: "is";
      value: unknown;
    }
  | {
      column: string;
      op: "in";
      value: unknown[];
    };

const workspaceRow = {
  context_description: "Shared workspace context for demo page tests.",
  created_at: "2026-05-01T09:00:00.000Z",
  id: "workspace-1",
  name: "Alexandria Team",
  slug: "alexandria-team",
  tier: "basic",
};

const profileRow = {
  auth_user_id: "auth-user-1",
  deleted_at: null,
  display_name: "Person",
  id: "profile-1",
};

const memoryOne = {
  author_profile_id: null,
  content: "Remember that the MVP demo uses deterministic local providers.",
  created_at: "2026-05-01T10:00:00.000Z",
  deleted_at: null,
  id: "memory-1",
  kind: "policy",
  metadata: {
    author_label: "MCP key",
    source: "mcp",
    source_client: "demo-check",
  },
  processed_at: "2026-05-01T10:01:00.000Z",
  status: "active",
  superseded_by_memory_id: null,
  title: "MVP demo policy",
  updated_at: "2026-05-01T10:01:00.000Z",
  workspace_id: "workspace-1",
};

const memoryTwo = {
  ...memoryOne,
  content: "Remember that the MVP demo should stay fast and focused.",
  id: "memory-2",
  title: "MVP demo focus",
};

class MockQueryBuilder implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Filter[] = [];
  private limitValue: number | null = null;
  private orderSpec: { ascending: boolean; column: string } | null = null;

  constructor(private readonly sourceRows: Row[]) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ column, op: "is", value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ column, op: "in", value });
    return this;
  }

  textSearch() {
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderSpec = {
      ascending: options?.ascending ?? true,
      column,
    };
    return this;
  }

  async limit(limit: number) {
    this.limitValue = limit;
    return this.response();
  }

  async maybeSingle() {
    return {
      data: this.filteredRows()[0] ?? null,
      error: null,
    };
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.response()).then(onfulfilled, onrejected);
  }

  private filteredRows() {
    let rows = this.sourceRows.filter((row) =>
      this.filters.every((filter) => {
        const value = row[filter.column];

        if (filter.op === "eq") {
          return value === filter.value;
        }

        if (filter.op === "is") {
          return filter.value === null
            ? value === null || value === undefined
            : value === filter.value;
        }

        return filter.value.includes(value);
      }),
    );

    if (this.orderSpec) {
      const { ascending, column } = this.orderSpec;
      rows = [...rows].sort((left, right) => {
        const leftValue = String(left[column] ?? "");
        const rightValue = String(right[column] ?? "");
        const order = leftValue.localeCompare(rightValue);
        return ascending ? order : -order;
      });
    }

    return this.limitValue === null ? rows : rows.slice(0, this.limitValue);
  }

  private response() {
    return {
      data: this.filteredRows(),
      error: null,
    };
  }
}

function mockSupabase({
  role,
  rows = {},
}: {
  role: "admin" | "member";
  rows?: TableRows;
}) {
  const tableCalls: string[] = [];
  const defaultRows: TableRows = {
    profiles: [profileRow],
    workspace_members: [
      {
        joined_at: "2026-05-01T10:00:00.000Z",
        profile_id: "profile-1",
        role,
        workspace_id: "workspace-1",
      },
    ],
    workspaces: [workspaceRow],
  };
  const from = vi.fn((table: string) => {
    tableCalls.push(table);
    return new MockQueryBuilder(rows[table] ?? defaultRows[table] ?? []);
  });

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            email: "person@example.com",
            id: "auth-user-1",
          },
        },
        error: null,
      })),
    },
    from,
  } as never);

  return { tableCalls };
}

describe("workspace memory pages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders memory browse results with search filters and tags", async () => {
    mockSupabase({
      role: "admin",
      rows: {
        memories: [memoryOne],
        memory_tags: [
          {
            deleted_at: null,
            memory_id: "memory-1",
            workspace_id: "workspace-1",
            workspace_tags: { name: "demo" },
          },
        ],
      },
    });

    const html = renderToString(
      await MemoriesPage({
        params: Promise.resolve({ slug: "alexandria-team" }),
        searchParams: Promise.resolve({ kind: "policy", q: "demo" }),
      }),
    );

    expect(html).toContain("MVP demo policy");
    expect(html).toContain("MCP key");
    expect(html).toContain("demo");
    expect(html).toContain('name="q"');
  });

  it("renders memory detail metadata and revisions", async () => {
    mockSupabase({
      role: "admin",
      rows: {
        memories: [memoryOne],
        memory_revisions: [
          {
            created_at: "2026-05-01T10:01:00.000Z",
            deleted_at: null,
            id: "revision-1",
            kind: "policy",
            memory_id: "memory-1",
            revision_number: 2,
            status: "active",
            workspace_id: "workspace-1",
          },
        ],
        memory_tags: [
          {
            deleted_at: null,
            memory_id: "memory-1",
            workspace_id: "workspace-1",
            workspace_tags: { name: "demo" },
          },
        ],
      },
    });

    const html = renderToString(
      await MemoryDetailPage({
        params: Promise.resolve({
          memoryId: "memory-1",
          slug: "alexandria-team",
        }),
      }),
    );

    expect(html).toContain("MVP demo policy");
    expect(html).toContain("Remember that the MVP demo uses");
    expect(html).toContain("MCP key");
    expect(html).toContain("Recent revisions");
    expect(html).toContain("<td>2</td>");
  });
});

describe("workspace governance pages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders unresolved conflicts for admins", async () => {
    const { tableCalls } = mockSupabase({
      role: "admin",
      rows: {
        conflicts: [
          {
            created_at: "2026-05-01T10:02:00.000Z",
            deleted_at: null,
            id: "conflict-1",
            source_memory_id: "memory-1",
            status: "unresolved",
            target_memory_id: "memory-2",
            workspace_id: "workspace-1",
          },
        ],
        memories: [memoryOne, memoryTwo],
      },
    });

    const html = renderToString(
      await ConflictsPage({
        params: Promise.resolve({ slug: "alexandria-team" }),
      }),
    );

    expect(tableCalls).toContain("conflicts");
    expect(tableCalls).toContain("memories");
    expect(html).toContain("conflict-1");
    expect(html).toContain("MVP demo policy");
    expect(html).toContain("MVP demo focus");
  });

  it("does not query conflicts for members", async () => {
    const { tableCalls } = mockSupabase({
      role: "member",
      rows: {
        conflicts: [
          {
            id: "hidden-conflict",
            source_memory_id: "hidden-memory",
            target_memory_id: "hidden-target",
          },
        ],
      },
    });

    const html = renderToString(
      await ConflictsPage({
        params: Promise.resolve({ slug: "alexandria-team" }),
      }),
    );

    expect(tableCalls).not.toContain("conflicts");
    expect(html).toContain("workspace admins only");
    expect(html).not.toContain("hidden-conflict");
  });

  it("renders audit events for admins", async () => {
    const { tableCalls } = mockSupabase({
      role: "admin",
      rows: {
        audit_log_memory: [
          {
            action: "memory_saved",
            actor_label: "MCP key",
            actor_type: "mcp_key",
            created_at: "2026-05-01T10:02:00.000Z",
            id: "audit-memory-1",
            target_memory_id: "memory-1",
            workspace_id: "workspace-1",
          },
        ],
        audit_log_workspace: [
          {
            action: "mcp_key_issued",
            actor_label: "Admin user",
            actor_type: "profile",
            created_at: "2026-05-01T10:01:00.000Z",
            id: "audit-workspace-1",
            target_mcp_key_id: "key-1",
            workspace_id: "workspace-1",
          },
        ],
      },
    });

    const html = renderToString(
      await AuditPage({
        params: Promise.resolve({ slug: "alexandria-team" }),
      }),
    );

    expect(tableCalls).toContain("audit_log_memory");
    expect(tableCalls).toContain("audit_log_workspace");
    expect(html).toContain("memory_saved");
    expect(html).toContain("mcp_key_issued");
    expect(html).toContain("Admin user");
  });

  it("does not query audit tables for members", async () => {
    const { tableCalls } = mockSupabase({
      role: "member",
      rows: {
        audit_log_memory: [{ action: "hidden_memory_audit" }],
        audit_log_workspace: [{ action: "hidden_workspace_audit" }],
      },
    });

    const html = renderToString(
      await AuditPage({
        params: Promise.resolve({ slug: "alexandria-team" }),
      }),
    );

    expect(tableCalls).not.toContain("audit_log_memory");
    expect(tableCalls).not.toContain("audit_log_workspace");
    expect(html).toContain("workspace admins only");
    expect(html).not.toContain("hidden_memory_audit");
  });

  it("renders usage summary and events for admins", async () => {
    const { tableCalls } = mockSupabase({
      role: "admin",
      rows: {
        usage_events: [
          {
            cost_estimate_cents: 3,
            embedding_tokens: 55,
            event_type: "memory_process_completed",
            id: "usage-1",
            llm_input_tokens: 100,
            llm_model: "deterministic",
            llm_output_tokens: 20,
            occurred_at: "2026-05-01T10:03:00.000Z",
            processing_tier: "basic",
            workspace_id: "workspace-1",
          },
        ],
      },
    });

    const html = renderToString(
      await UsagePage({
        params: Promise.resolve({ slug: "alexandria-team" }),
      }),
    );

    expect(tableCalls).toContain("usage_events");
    expect(html).toContain("memory_process_completed");
    expect(html).toContain("deterministic");
    expect(html).toContain("$0.03");
    expect(html).toContain("<strong>1</strong>");
  });

  it("does not query usage tables for members", async () => {
    const { tableCalls } = mockSupabase({
      role: "member",
      rows: {
        usage_events: [{ event_type: "hidden_usage" }],
      },
    });

    const html = renderToString(
      await UsagePage({
        params: Promise.resolve({ slug: "alexandria-team" }),
      }),
    );

    expect(tableCalls).not.toContain("usage_events");
    expect(html).toContain("workspace admins only");
    expect(html).not.toContain("hidden_usage");
  });
});
