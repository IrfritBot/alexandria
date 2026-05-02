import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { GET } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("../../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

function makeRequest(path: string) {
  return new Request(`https://alexandria.test${path}`);
}

function expectRedirect(response: Response, location: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(location);
}

function mockSupabase({
  exchangeError = null,
  rpcError = null,
  user = {
    email: "person@example.com",
    user_metadata: {
      full_name: "Person Example",
    },
  },
}: {
  exchangeError?: { message: string } | null;
  rpcError?: { message: string } | null;
  user?: {
    email?: string | null;
    user_metadata?: {
      full_name?: string | null;
      name?: string | null;
    };
  };
} = {}) {
  const exchangeCodeForSession = vi.fn(async () => ({
    data: exchangeError
      ? { session: null }
      : {
          session: {
            user,
          },
        },
    error: exchangeError,
  }));
  const rpc = vi.fn(async () => ({
    data: rpcError ? null : { id: "profile-id" },
    error: rpcError,
  }));

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      exchangeCodeForSession,
    },
    rpc,
  } as never);

  return {
    exchangeCodeForSession,
    rpc,
  };
}

describe("auth callback route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects when the code is missing", async () => {
    const response = await GET(makeRequest("/auth/callback"));

    expectRedirect(
      response,
      "https://alexandria.test/login?error=missing_code",
    );
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("redirects when the auth code exchange fails", async () => {
    const { exchangeCodeForSession, rpc } = mockSupabase({
      exchangeError: { message: "invalid code" },
    });

    const response = await GET(makeRequest("/auth/callback?code=bad"));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("bad");
    expect(rpc).not.toHaveBeenCalled();
    expectRedirect(
      response,
      "https://alexandria.test/login?error=exchange_failed",
    );
  });

  it("redirects when profile sync fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rpc } = mockSupabase({
      rpcError: { message: "rpc failed" },
    });

    const response = await GET(makeRequest("/auth/callback?code=ok"));

    expect(rpc).toHaveBeenCalledWith("ensure_profile", {
      p_display_name: "Person Example",
      p_email: "person@example.com",
    });
    expect(errorSpy).toHaveBeenCalled();
    expectRedirect(
      response,
      "https://alexandria.test/login?error=profile_sync_failed",
    );
  });

  it.each([null, ""])(
    "redirects without syncing when the session email is %s",
    async (email) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { exchangeCodeForSession, rpc } = mockSupabase({
        user: {
          email,
          user_metadata: {
            full_name: "Person Example",
          },
        },
      });

      const response = await GET(makeRequest("/auth/callback?code=ok"));

      expect(exchangeCodeForSession).toHaveBeenCalledWith("ok");
      expect(rpc).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        "Profile sync failed: auth callback session had no email.",
      );
      expectRedirect(
        response,
        "https://alexandria.test/login?error=profile_sync_failed",
      );
    },
  );

  it("redirects to a valid next path on success", async () => {
    const { rpc } = mockSupabase();

    const response = await GET(
      makeRequest("/auth/callback?code=ok&next=%2Fworkspaces%2Fnew"),
    );

    expect(rpc).toHaveBeenCalledOnce();
    expectRedirect(response, "https://alexandria.test/workspaces/new");
  });

  it("falls back to root when next is malicious", async () => {
    mockSupabase();

    const response = await GET(
      makeRequest(
        "/auth/callback?code=ok&next=https%3A%2F%2Fevil.example%2F",
      ),
    );

    expectRedirect(response, "https://alexandria.test/");
  });
});
