import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("../../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const validBody = {
  name: "Alexandria Team",
  slug: "alexandria-team",
  contextDescription:
    "Shared memory for decisions, policies, and important team context.",
};

function makeRequest(body: unknown) {
  return new Request("https://alexandria.test/api/workspaces", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function mockSupabase({
  user = { id: "auth-user-1", email: "person@example.com" },
  rpcResponse = { data: "workspace-1", error: null },
}: {
  user?: { id: string; email: string } | null;
  rpcResponse?: {
    data: unknown;
    error: { code?: string; message?: string } | null;
  };
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
    error: null,
  }));
  const rpc = vi.fn(async () => rpcResponse);

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser,
    },
    rpc,
  } as never);

  return {
    getUser,
    rpc,
  };
}

describe("workspaces route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 for unauthenticated callers", async () => {
    const { rpc } = mockSupabase({ user: null });

    const response = await POST(makeRequest(validBody));

    await expect(response.json()).resolves.toEqual({
      error: "unauthenticated",
    });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid input", async () => {
    const { rpc } = mockSupabase();

    const response = await POST(
      makeRequest({
        ...validBody,
        contextDescription: "too short",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "invalid_input",
      field: "contextDescription",
    });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 409 for duplicate slugs", async () => {
    mockSupabase({
      rpcResponse: {
        data: null,
        error: {
          code: "23505",
          message: "workspace slug already exists",
        },
      },
    });

    const response = await POST(makeRequest(validBody));

    await expect(response.json()).resolves.toEqual({
      error: "slug_taken",
    });
    expect(response.status).toBe(409);
  });

  it("returns the workspace id on success and uses the admin bootstrap RPC", async () => {
    const { rpc } = mockSupabase();

    const response = await POST(makeRequest(validBody));
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260502004733_workspace_bootstrap_rpc.sql",
      ),
      "utf8",
    );

    await expect(response.json()).resolves.toEqual({
      workspaceId: "workspace-1",
    });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_workspace_with_admin", {
      p_context_description: validBody.contextDescription,
      p_name: validBody.name,
      p_slug: validBody.slug,
    });
    expect(sql).toContain("insert into public.workspace_members");
    expect(sql).toContain("'admin'");
  });
});
