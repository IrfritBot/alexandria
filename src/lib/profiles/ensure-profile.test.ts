import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../supabase/server";
import { ensureProfile } from "./ensure-profile";

vi.mock("server-only", () => ({}));

vi.mock("../supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const profile = {
  id: "profile-1",
  auth_user_id: "auth-user-1",
  email: "person@example.com",
  display_name: "Person Example",
  created_at: "2026-05-02T00:00:00.000Z",
  updated_at: "2026-05-02T00:00:00.000Z",
  deleted_at: null,
};

function mockRpc(
  responses: Array<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>,
) {
  const rpc = vi.fn();

  for (const response of responses) {
    rpc.mockResolvedValueOnce(response);
  }

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    rpc,
  } as never);

  return rpc;
}

describe("ensureProfile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the profile RPC for first sign-in", async () => {
    const rpc = mockRpc([{ data: profile, error: null }]);

    await expect(
      ensureProfile({
        email: "person@example.com",
        displayName: "Person Example",
      }),
    ).resolves.toEqual({
      ok: true,
      profile,
    });
    expect(rpc).toHaveBeenCalledWith("ensure_profile", {
      p_display_name: "Person Example",
      p_email: "person@example.com",
    });
  });

  it("keeps a stable profile id across repeated sign-ins", async () => {
    const rpc = mockRpc([
      { data: profile, error: null },
      {
        data: {
          ...profile,
          email: "person+updated@example.com",
          display_name: "Updated Person",
          updated_at: "2026-05-02T00:01:00.000Z",
        },
        error: null,
      },
    ]);

    const first = await ensureProfile({
      email: "person@example.com",
      displayName: "Person Example",
    });
    const second = await ensureProfile({
      email: "person+updated@example.com",
      displayName: "Updated Person",
    });

    expect(first.ok && first.profile.id).toBe("profile-1");
    expect(second.ok && second.profile.id).toBe("profile-1");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("maps unauthenticated RPC failures", async () => {
    mockRpc([
      {
        data: null,
        error: {
          code: "28000",
          message: "ensure_profile requires authenticated user",
        },
      },
    ]);

    await expect(
      ensureProfile({ email: "person@example.com" }),
    ).resolves.toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("maps invalid email RPC failures", async () => {
    mockRpc([
      {
        data: null,
        error: {
          code: "22023",
          message: "invalid email",
        },
      },
    ]);

    await expect(ensureProfile({ email: "invalid" })).resolves.toEqual({
      ok: false,
      reason: "invalid_email",
    });
  });

  it("defines a scoped SECURITY DEFINER RPC migration", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260502004411_profile_sync_rpc.sql",
      ),
      "utf8",
    );

    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("v_auth_user_id uuid := auth.uid()");
    expect(sql).toContain("on conflict (auth_user_id) do update");
    expect(sql).toContain(
      "grant execute on function public.ensure_profile(text, text) to authenticated",
    );
    expect(sql).not.toMatch(/create policy profiles_.*insert/i);
  });
});
