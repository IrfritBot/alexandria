import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";
import { OAUTH_CSRF_COOKIE_NAME } from "../../../lib/oauth/csrf";
import { GET, POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("../../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("../../../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

const authorizeUrl =
  "https://alexandria.test/oauth/authorize?response_type=code&client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=challenge&code_challenge_method=S256&state=state-1";

const clientRow = {
  client_id: "client-1",
  client_name: "Claude",
  redirect_uris: ["https://client.example/callback"],
};

const profileRow = {
  id: "profile-1",
};

const membershipRows = [
  {
    role: "admin",
    workspace_id: "workspace-1",
    workspaces: {
      name: "Alexandria",
      slug: "alexandria",
    },
  },
];

function mockAuthorizeSupabase({
  client = clientRow,
  insertError = null,
  memberships = membershipRows,
  profile = profileRow,
  user = { id: "auth-user-1" },
}: {
  client?: unknown;
  insertError?: unknown;
  memberships?: unknown[];
  profile?: unknown;
  user?: { id: string } | null;
} = {}) {
  const getUser = vi.fn(async () => ({
    data: { user },
    error: null,
  }));
  const insertAuthorizationCode = vi.fn(async () => ({ error: insertError }));
  const from = vi.fn((table: string) => {
    const builder = {
      eq: vi.fn(() => {
        if (table === "workspace_members") {
          return Promise.resolve({ data: memberships, error: null });
        }

        return builder;
      }),
      insert: vi.fn(insertAuthorizationCode),
      is: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        if (table === "oauth_clients") {
          return { data: client, error: null };
        }

        if (table === "profiles") {
          return { data: profile, error: null };
        }

        return { data: null, error: null };
      }),
      order: vi.fn(async () => {
        return { data: memberships, error: null };
      }),
      select: vi.fn(() => builder),
    };

    return builder;
  });

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser },
    from,
  } as never);
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ from } as never);

  return { from, insertAuthorizationCode };
}

function form(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: "client-1",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    csrf_token: "csrf-1",
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    scope: "memory:read memory:write",
    state: "state-1",
    decision: "approve",
    workspace_id: "workspace-1",
    ...overrides,
  });
}

describe("OAuth authorize route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects unauthenticated users to login while preserving the authorize URL", async () => {
    mockAuthorizeSupabase({ user: null });

    const response = await GET(new Request(authorizeUrl));
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/oauth/authorize?response_type=code&client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=challenge&code_challenge_method=S256&state=state-1",
    );
  });

  it("rejects invalid clients and invalid PKCE requests", async () => {
    mockAuthorizeSupabase({ client: null });

    const invalidClient = await GET(new Request(authorizeUrl));

    expect(invalidClient.status).toBe(400);
    await expect(invalidClient.text()).resolves.toContain(
      "Invalid OAuth request",
    );

    mockAuthorizeSupabase();

    const invalidChallenge = await GET(
      new Request(authorizeUrl.replace("code_challenge_method=S256", "code_challenge_method=plain")),
    );

    expect(invalidChallenge.status).toBe(400);
    await expect(invalidChallenge.text()).resolves.toContain(
      "Invalid OAuth request",
    );
  });

  it("renders consent HTML with a CSRF cookie for signed-in users", async () => {
    mockAuthorizeSupabase();

    const response = await GET(new Request(authorizeUrl));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      `${OAUTH_CSRF_COOKIE_NAME}=`,
    );
    expect(html).toContain("Authorize Claude");
    expect(html).toContain("memory:read");
    expect(html).toContain("workspace-1");
  });

  it("rejects consent POSTs with invalid CSRF before inserting a code", async () => {
    const { insertAuthorizationCode } = mockAuthorizeSupabase();

    const response = await POST(
      new Request("https://alexandria.test/oauth/authorize", {
        body: form(),
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(insertAuthorizationCode).not.toHaveBeenCalled();
  });

  it("enforces selected workspace membership on consent POST", async () => {
    const { insertAuthorizationCode } = mockAuthorizeSupabase();

    const response = await POST(
      new Request("https://alexandria.test/oauth/authorize", {
        body: form({ workspace_id: "workspace-other" }),
        headers: {
          cookie: `${OAUTH_CSRF_COOKIE_NAME}=csrf-1`,
        },
        method: "POST",
      }),
    );
    const redirect = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(insertAuthorizationCode).not.toHaveBeenCalled();
  });

  it("requires an explicit approve decision before issuing an authorization code", async () => {
    const { insertAuthorizationCode } = mockAuthorizeSupabase();
    const body = form();

    body.delete("decision");
    body.set("submit_action", "approve");

    const response = await POST(
      new Request("https://alexandria.test/oauth/authorize", {
        body,
        headers: {
          cookie: `${OAUTH_CSRF_COOKIE_NAME}=csrf-1`,
        },
        method: "POST",
      }),
    );
    const redirect = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(insertAuthorizationCode).not.toHaveBeenCalled();
  });

  it("issues a short-lived authorization code and redirects back to the client", async () => {
    const { insertAuthorizationCode } = mockAuthorizeSupabase();

    const response = await POST(
      new Request("https://alexandria.test/oauth/authorize", {
        body: form(),
        headers: {
          cookie: `${OAUTH_CSRF_COOKIE_NAME}=csrf-1`,
        },
        method: "POST",
      }),
    );
    const redirect = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(redirect.origin).toBe("https://client.example");
    expect(redirect.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(redirect.searchParams.get("state")).toBe("state-1");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(insertAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client-1",
        code_challenge: "challenge",
        profile_id: "profile-1",
        scopes: ["memory:read", "memory:write"],
        workspace_id: "workspace-1",
      }),
    );
  });
});
