import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

function makeRequest(path = "/logout") {
  return new Request(`https://alexandria.test${path}`, {
    method: "POST",
  });
}

function mockSupabase({
  error = null,
  throws = false,
}: {
  error?: { message: string } | null;
  throws?: boolean;
} = {}) {
  const signOut = vi.fn(async () => {
    if (throws) {
      throw new Error("network failed");
    }

    return { error };
  });

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      signOut,
    },
  } as never);

  return {
    signOut,
  };
}

function expectRedirect(response: Response, location: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(location);
}

describe("logout route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signs out and redirects to login", async () => {
    const { signOut } = mockSupabase();

    const response = await POST(makeRequest());

    expect(signOut).toHaveBeenCalledOnce();
    expectRedirect(response, "https://alexandria.test/login");
  });

  it("ignores arbitrary return paths", async () => {
    mockSupabase();

    const response = await POST(
      makeRequest("/logout?next=https%3A%2F%2Fevil.example"),
    );

    expectRedirect(response, "https://alexandria.test/login");
  });

  it("redirects with a controlled error when Supabase sign-out fails", async () => {
    mockSupabase({
      error: { message: "failed" },
    });

    const response = await POST(makeRequest());

    expectRedirect(
      response,
      "https://alexandria.test/login?error=logout_failed",
    );
  });

  it("redirects with a controlled error when sign-out throws", async () => {
    mockSupabase({
      throws: true,
    });

    const response = await POST(makeRequest());

    expectRedirect(
      response,
      "https://alexandria.test/login?error=logout_failed",
    );
  });
});
