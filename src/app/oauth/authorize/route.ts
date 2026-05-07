import {
  getAuthorizeClientId,
  redirectWithOAuthResult,
  validateAuthorizeRequest,
  type OAuthAuthorizeRequest,
} from "../../../lib/oauth/authorize";
import { type OAuthClientRecord } from "../../../lib/oauth/clients";
import {
  OAUTH_CSRF_COOKIE_NAME,
  clearOauthCsrfCookieOptions,
  createOauthCsrfToken,
  oauthCsrfCookieOptions,
  verifyOauthCsrfToken,
} from "../../../lib/oauth/csrf";
import { randomToken, sha256Token } from "../../../lib/oauth/crypto";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";

export const dynamic = "force-dynamic";

type SupabaseError = {
  message?: string;
};

type ServiceClient = {
  from(tableName: "oauth_clients" | "oauth_authorization_codes"): {
    insert(payload: Record<string, unknown>): Promise<{ error: SupabaseError | null }>;
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: unknown; error: SupabaseError | null }>;
      };
    };
  };
};

type ServerClient = {
  auth: {
    getUser(): Promise<{
      data: { user: { email?: string | null; id: string } | null };
      error: SupabaseError | null;
    }>;
  };
  from(tableName: "profiles" | "workspace_members"): {
    select(columns: string): {
      eq(column: string, value: string): unknown;
    };
  };
};

type Profile = {
  id: string;
};

type WorkspaceOption = {
  id: string;
  name: string;
  role: string;
};

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeCookie(
  name: string,
  value: string,
  options: ReturnType<typeof oauthCsrfCookieOptions>,
) {
  const parts = [
    `${name}=${value}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function htmlResponse(body: string, status: number, csrfToken?: string) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
  });

  if (csrfToken) {
    headers.set(
      "set-cookie",
      serializeCookie(
        OAUTH_CSRF_COOKIE_NAME,
        csrfToken,
        oauthCsrfCookieOptions(),
      ),
    );
  }

  return new Response(body, { headers, status });
}

function redirectResponse(location: string, clearCsrf = false) {
  const headers = new Headers({
    "cache-control": "no-store",
    location,
  });

  if (clearCsrf) {
    headers.set(
      "set-cookie",
      serializeCookie(OAUTH_CSRF_COOKIE_NAME, "", clearOauthCsrfCookieOptions()),
    );
  }

  return new Response(null, {
    headers,
    status: 303,
  });
}

function invalidAuthorizeRequest() {
  return htmlResponse("Invalid OAuth request.", 400);
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");

    if (rawName === name) {
      return rawValue.join("=");
    }
  }

  return null;
}

function loginRedirect(requestUrl: URL) {
  const next = `${requestUrl.pathname}${requestUrl.search}`;

  return redirectResponse(
    `${requestUrl.origin}/login?next=${encodeURIComponent(next)}`,
  );
}

function normalizeClient(row: unknown): OAuthClientRecord | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return null;
  }

  const record = row as Record<string, unknown>;

  if (
    typeof record.client_id !== "string" ||
    typeof record.client_name !== "string" ||
    !Array.isArray(record.redirect_uris) ||
    !record.redirect_uris.every((value): value is string => typeof value === "string")
  ) {
    return null;
  }

  return {
    client_id: record.client_id,
    client_name: record.client_name,
    redirect_uris: record.redirect_uris,
  };
}

async function loadClient(clientId: string | null) {
  if (!clientId) {
    return null;
  }

  const supabase = (createSupabaseServiceRoleClient() as unknown) as ServiceClient;
  const { data, error } = await supabase
    .from("oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return normalizeClient(data);
}

function normalizeProfile(row: unknown): Profile | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return null;
  }

  const record = row as Record<string, unknown>;

  return typeof record.id === "string" ? { id: record.id } : null;
}

function normalizeWorkspaceOptions(rows: unknown): WorkspaceOption[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return [];
    }

    const record = row as Record<string, unknown>;
    const workspace =
      typeof record.workspaces === "object" &&
      record.workspaces !== null &&
      !Array.isArray(record.workspaces)
        ? (record.workspaces as Record<string, unknown>)
        : null;

    if (
      typeof record.workspace_id !== "string" ||
      typeof record.role !== "string"
    ) {
      return [];
    }

    return [
      {
        id: record.workspace_id,
        name:
          typeof workspace?.name === "string"
            ? workspace.name
            : record.workspace_id,
        role: record.role,
      },
    ];
  });
}

async function loadProfileAndWorkspaces(
  supabase: ServerClient,
  authUserId: string,
): Promise<{ ok: true; profile: Profile; workspaces: WorkspaceOption[] } | { ok: false }> {
  const profileQuery = supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId) as {
    is(column: string, value: null): {
      maybeSingle(): Promise<{ data: unknown; error: SupabaseError | null }>;
    };
  };
  const { data: profileRow, error: profileError } = await profileQuery
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError) {
    return { ok: false };
  }

  const profile = normalizeProfile(profileRow);

  if (!profile) {
    return { ok: false };
  }

  const workspaceQuery = supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name)") as {
    eq(
      column: string,
      value: string,
    ): Promise<{ data: unknown; error: SupabaseError | null }>;
  };
  const { data: membershipRows, error: membershipError } = await workspaceQuery.eq(
    "profile_id",
    profile.id,
  );

  if (membershipError) {
    return { ok: false };
  }

  return {
    ok: true,
    profile,
    workspaces: normalizeWorkspaceOptions(membershipRows),
  };
}

function consentHtml(input: {
  client: OAuthClientRecord;
  csrfToken: string;
  request: OAuthAuthorizeRequest;
  workspaces: WorkspaceOption[];
}) {
  const workspaceOptions = input.workspaces
    .map(
      (workspace) =>
        `<option value="${htmlEscape(workspace.id)}">${htmlEscape(
          workspace.name,
        )}</option>`,
    )
    .join("");
  const scopeItems = input.request.scopes
    .map((scope) => `<li>${htmlEscape(scope)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta name="robots" content="noindex" />
    <title>Authorize Alexandria connector</title>
  </head>
  <body>
    <main>
      <h1>Authorize ${htmlEscape(input.client.client_name)}</h1>
      <form method="post" action="/oauth/authorize">
        <input type="hidden" name="csrf_token" value="${htmlEscape(input.csrfToken)}" />
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="client_id" value="${htmlEscape(input.request.clientId)}" />
        <input type="hidden" name="redirect_uri" value="${htmlEscape(input.request.redirectUri)}" />
        <input type="hidden" name="code_challenge" value="${htmlEscape(input.request.codeChallenge)}" />
        <input type="hidden" name="code_challenge_method" value="S256" />
        <input type="hidden" name="scope" value="${htmlEscape(input.request.scope)}" />
        <input type="hidden" name="state" value="${htmlEscape(input.request.state ?? "")}" />
        <label for="workspace_id">Workspace</label>
        <select id="workspace_id" name="workspace_id" required>
          ${workspaceOptions}
        </select>
        <ul>${scopeItems}</ul>
        <button type="submit" name="decision" value="approve">Approve</button>
        <button type="submit" name="decision" value="deny">Deny</button>
      </form>
    </main>
  </body>
</html>`;
}

function formSearchParams(formData: FormData) {
  const searchParams = new URLSearchParams();

  for (const name of [
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "scope",
    "state",
  ]) {
    const value = formData.get(name);

    if (typeof value === "string" && value.length > 0) {
      searchParams.set(name, value);
    }
  }

  return searchParams;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const client = await loadClient(getAuthorizeClientId(requestUrl.searchParams));
  const validatedRequest = validateAuthorizeRequest(
    requestUrl.searchParams,
    client,
  );

  if (!validatedRequest.ok || !client) {
    return invalidAuthorizeRequest();
  }

  const supabase = (await createSupabaseServerClient()) as unknown as ServerClient;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return loginRedirect(requestUrl);
  }

  const context = await loadProfileAndWorkspaces(supabase, user.id);

  if (!context.ok || context.workspaces.length === 0) {
    return htmlResponse("No workspace access.", 403);
  }

  const csrfToken = createOauthCsrfToken();

  return htmlResponse(
    consentHtml({
      client,
      csrfToken,
      request: validatedRequest.request,
      workspaces: context.workspaces,
    }),
    200,
    csrfToken,
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const csrfToken = typeof formData.get("csrf_token") === "string"
    ? String(formData.get("csrf_token"))
    : null;

  if (
    !verifyOauthCsrfToken(
      cookieValue(request, OAUTH_CSRF_COOKIE_NAME),
      csrfToken,
    )
  ) {
    return htmlResponse("Invalid OAuth consent token.", 403);
  }

  const searchParams = formSearchParams(formData);
  const client = await loadClient(getAuthorizeClientId(searchParams));
  const validatedRequest = validateAuthorizeRequest(searchParams, client);

  if (!validatedRequest.ok || !client) {
    return redirectResponse("/", true);
  }

  const oauthRequest = validatedRequest.request;

  if (formData.get("decision") === "deny") {
    return redirectResponse(
      redirectWithOAuthResult({
        error: "access_denied",
        redirectUri: oauthRequest.redirectUri,
        state: oauthRequest.state,
      }),
      true,
    );
  }

  const supabase = (await createSupabaseServerClient()) as unknown as ServerClient;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return redirectResponse("/", true);
  }

  const context = await loadProfileAndWorkspaces(supabase, user.id);
  const workspaceId =
    typeof formData.get("workspace_id") === "string"
      ? String(formData.get("workspace_id"))
      : "";

  if (
    !context.ok ||
    !context.workspaces.some((workspace) => workspace.id === workspaceId)
  ) {
    return redirectResponse(
      redirectWithOAuthResult({
        error: "access_denied",
        redirectUri: oauthRequest.redirectUri,
        state: oauthRequest.state,
      }),
      true,
    );
  }

  const authorizationCode = randomToken(32);
  const serviceClient = (createSupabaseServiceRoleClient() as unknown) as ServiceClient;
  const { error: insertError } = await serviceClient
    .from("oauth_authorization_codes")
    .insert({
      client_id: oauthRequest.clientId,
      code_challenge: oauthRequest.codeChallenge,
      code_challenge_method: oauthRequest.codeChallengeMethod,
      code_hash: sha256Token(authorizationCode),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      profile_id: context.profile.id,
      redirect_uri: oauthRequest.redirectUri,
      scopes: oauthRequest.scopes,
      workspace_id: workspaceId,
    });

  if (insertError) {
    return redirectResponse(
      redirectWithOAuthResult({
        error: "server_error",
        redirectUri: oauthRequest.redirectUri,
        state: oauthRequest.state,
      }),
      true,
    );
  }

  return redirectResponse(
    redirectWithOAuthResult({
      code: authorizationCode,
      redirectUri: oauthRequest.redirectUri,
      state: oauthRequest.state,
    }),
    true,
  );
}
