import { describe, expect, it, vi } from "vitest";

import {
  firstSearchParamValue,
  getAuthPageState,
  getAuthRequestOrigin,
} from "./auth-page";

function mockSupabase(user: unknown | null) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
  }));

  return {
    auth: {
      getUser,
    },
    getUser,
  };
}

describe("auth page helpers", () => {
  it("normalizes query parameter values", () => {
    expect(firstSearchParamValue(undefined)).toBeNull();
    expect(firstSearchParamValue("one")).toBe("one");
    expect(firstSearchParamValue(["one", "two"])).toBe("one");
    expect(firstSearchParamValue([])).toBeNull();
  });

  it("derives the public request origin from forwarded headers", () => {
    const headers = new Headers({
      host: "internal.local:3000",
      "x-forwarded-host": "alexandria.example",
      "x-forwarded-proto": "https",
    });

    expect(getAuthRequestOrigin(headers)).toBe("https://alexandria.example");
  });

  it("falls back to localhost-style http origins for local hosts", () => {
    const headers = new Headers({
      host: "localhost:3000",
    });

    expect(getAuthRequestOrigin(headers)).toBe("http://localhost:3000");
  });

  it("renders auth UI for signed-out users with a shared callback URL", async () => {
    const supabase = mockSupabase(null);

    await expect(
      getAuthPageState({
        origin: "https://alexandria.test",
        rawNext: "/workspaces/new",
        supabase,
      }),
    ).resolves.toEqual({
      callbackUrl:
        "https://alexandria.test/auth/callback?next=%2Fworkspaces%2Fnew",
      kind: "render",
    });
    expect(supabase.getUser).toHaveBeenCalledOnce();
  });

  it("redirects signed-in users to a safe next path", async () => {
    const supabase = mockSupabase({ id: "auth-user-1" });

    await expect(
      getAuthPageState({
        origin: "https://alexandria.test",
        rawNext: "/workspaces/new",
        supabase,
      }),
    ).resolves.toEqual({
      kind: "redirect",
      location: "/workspaces/new",
    });
  });

  it("falls signed-in malicious next values back to root", async () => {
    const supabase = mockSupabase({ id: "auth-user-1" });

    await expect(
      getAuthPageState({
        origin: "https://alexandria.test",
        rawNext: "https://evil.example",
        supabase,
      }),
    ).resolves.toEqual({
      kind: "redirect",
      location: "/",
    });
  });

  it("preserves signed-in MCP OAuth authorize continuations", async () => {
    const supabase = mockSupabase({ id: "auth-user-1" });
    const authorizeNext =
      "/oauth/authorize?response_type=code&client_id=alex_client_1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=abc&code_challenge_method=S256";

    await expect(
      getAuthPageState({
        origin: "https://alexandria.test",
        rawNext: authorizeNext,
        supabase,
      }),
    ).resolves.toEqual({
      kind: "redirect",
      location: authorizeNext,
    });
  });
});
