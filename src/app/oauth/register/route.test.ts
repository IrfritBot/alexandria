import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("../../../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

function makeRequest(payload: unknown) {
  return new Request("https://alexandria.test/oauth/register", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function mockRegisterInsert(error: unknown = null) {
  const insert = vi.fn(async () => ({ error }));
  const from = vi.fn(() => ({ insert }));

  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ from } as never);

  return { from, insert };
}

describe("OAuth dynamic client registration route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers public OAuth clients without issuing a secret", async () => {
    const { insert } = mockRegisterInsert();

    const response = await POST(
      makeRequest({
        client_name: "Claude",
        redirect_uris: ["http://localhost:3000/callback"],
      }),
    );

    const body = await response.json();

    expect(body).toEqual({
      client_id: expect.stringMatching(/^alex_client_[A-Za-z0-9_-]+$/),
      client_id_issued_at: expect.any(Number),
      client_name: "Claude",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://localhost:3000/callback"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(response.status).toBe(201);
    expect(JSON.stringify(body)).not.toContain("client_secret");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        client_name: "Claude",
        redirect_uris: ["http://localhost:3000/callback"],
      }),
    );
  });

  it("rejects invalid redirect URIs before touching Supabase", async () => {
    const response = await POST(
      makeRequest({
        client_name: "Claude",
        redirect_uris: ["javascript:alert(1)"],
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_client_metadata",
    });
    expect(response.status).toBe(400);
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns server_error when client storage fails", async () => {
    mockRegisterInsert({ message: "database unavailable" });

    const response = await POST(
      makeRequest({
        client_name: "Claude",
        redirect_uris: ["https://client.example/callback"],
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      error: "registration_failed",
    });
    expect(response.status).toBe(500);
  });
});
