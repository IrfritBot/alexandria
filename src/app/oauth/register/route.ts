import { createOAuthClientId, normalizeClientRegistrationPayload } from "../../../lib/oauth/clients";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";

export const dynamic = "force-dynamic";

type InsertClient = {
  from(tableName: "oauth_clients"): {
    insert(payload: {
      client_id: string;
      client_name: string;
      redirect_uris: string[];
    }): Promise<{
      error: { message?: string } | null;
    }>;
  };
};

function jsonResponse(body: unknown, status: number) {
  return Response.json(body, {
    headers: {
      "cache-control": "no-store",
    },
    status,
  });
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const payload = await parseJson(request);
  const normalizedPayload = normalizeClientRegistrationPayload(payload);

  if (!normalizedPayload.ok) {
    return jsonResponse(
      {
        error: "invalid_client_metadata",
        field: normalizedPayload.field,
      },
      400,
    );
  }

  const clientId = createOAuthClientId();

  try {
    const supabase = (createSupabaseServiceRoleClient() as unknown) as InsertClient;
    const { error } = await supabase.from("oauth_clients").insert({
      client_id: clientId,
      client_name: normalizedPayload.clientName,
      redirect_uris: normalizedPayload.redirectUris,
    });

    if (error) {
      return jsonResponse({ error: "registration_failed" }, 500);
    }
  } catch {
    return jsonResponse({ error: "registration_failed" }, 500);
  }

  return jsonResponse(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: normalizedPayload.clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: normalizedPayload.redirectUris,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}
