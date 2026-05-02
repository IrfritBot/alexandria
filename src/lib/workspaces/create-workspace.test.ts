import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../supabase/server";
import { createWorkspace } from "./create-workspace";

vi.mock("server-only", () => ({}));

vi.mock("../supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const validInput = {
  name: "Alexandria Team",
  slug: "alexandria-team",
  contextDescription:
    "Shared memory for decisions, policies, and important team context.",
};

function mockRpc(response: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}) {
  const rpc = vi.fn(async () => response);

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    rpc,
  } as never);

  return rpc;
}

function migrationSql() {
  return readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260502004733_workspace_bootstrap_rpc.sql",
    ),
    "utf8",
  );
}

describe("createWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a workspace through the bootstrap RPC", async () => {
    const rpc = mockRpc({
      data: "workspace-1",
      error: null,
    });

    await expect(createWorkspace(validInput)).resolves.toEqual({
      ok: true,
      workspaceId: "workspace-1",
    });
    expect(rpc).toHaveBeenCalledWith("create_workspace_with_admin", {
      p_context_description: validInput.contextDescription,
      p_name: validInput.name,
      p_slug: validInput.slug,
    });
  });

  it("maps duplicate slug conflicts", async () => {
    mockRpc({
      data: null,
      error: {
        code: "23505",
        message: "workspace slug already exists",
      },
    });

    await expect(createWorkspace(validInput)).resolves.toEqual({
      ok: false,
      reason: "slug_taken",
    });
  });

  it("rejects context descriptions that are too short before calling the RPC", async () => {
    const rpc = mockRpc({
      data: "workspace-1",
      error: null,
    });

    await expect(
      createWorkspace({
        ...validInput,
        contextDescription: "too short",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
      field: "contextDescription",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps unauthenticated RPC failures", async () => {
    mockRpc({
      data: null,
      error: {
        code: "28000",
        message: "unauthenticated",
      },
    });

    await expect(createWorkspace(validInput)).resolves.toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("maps missing profile RPC failures", async () => {
    mockRpc({
      data: null,
      error: {
        code: "P0001",
        message: "missing_profile",
      },
    });

    await expect(createWorkspace(validInput)).resolves.toEqual({
      ok: false,
      reason: "missing_profile",
    });
  });

  it("maps unmatched invalid-input RPC failures as generic creation failures", async () => {
    mockRpc({
      data: null,
      error: {
        code: "22023",
        message: "invalid input from another constraint",
      },
    });

    await expect(createWorkspace(validInput)).resolves.toEqual({
      ok: false,
      reason: "workspace_creation_failed",
    });
  });

  it("defines an atomic workspace/admin bootstrap migration", () => {
    const sql = migrationSql();

    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("v_auth_user_id uuid := auth.uid()");
    expect(sql).toContain("insert into public.workspaces");
    expect(sql).toContain("insert into public.workspace_members");
    expect(sql).toContain("'admin'");
    expect(sql).toContain("insert into public.audit_log_workspace");
    expect(sql).toContain("'workspace_created'");
    expect(sql).toContain(
      "grant execute on function public.create_workspace_with_admin(text, text, text) to authenticated",
    );
  });
});
