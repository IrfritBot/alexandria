import { describe, expect, it } from "vitest";

import {
  generateOauthClientId,
  normalizeOauthClientRegistrationPayload,
  validateRedirectUri,
} from "./clients";

describe("OAuth client helpers", () => {
  it("allows HTTPS and local loopback redirect URIs", () => {
    expect(validateRedirectUri("https://client.example/callback")).toBe(true);
    expect(validateRedirectUri("http://localhost:3000/callback")).toBe(true);
    expect(validateRedirectUri("http://127.0.0.1:1234/callback")).toBe(true);
    expect(validateRedirectUri("http://[::1]:1234/callback")).toBe(true);
  });

  it("rejects unsafe redirect URIs", () => {
    expect(validateRedirectUri("")).toBe(false);
    expect(validateRedirectUri("/callback")).toBe(false);
    expect(validateRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validateRedirectUri("http://example.com/callback")).toBe(false);
    expect(validateRedirectUri("https://*.example.com/callback")).toBe(false);
    expect(validateRedirectUri("https://example.com/callback#fragment")).toBe(
      false,
    );
  });

  it("normalizes dynamic registration payloads", () => {
    expect(
      normalizeOauthClientRegistrationPayload({
        client_name: "  Claude  ",
        redirect_uris: [
          "http://localhost:3000/callback",
          "http://localhost:3000/callback",
        ],
      }),
    ).toEqual({
      client: {
        clientName: "Claude",
        redirectUris: ["http://localhost:3000/callback"],
      },
      ok: true,
    });
    expect(generateOauthClientId()).toMatch(/^alex_client_[A-Za-z0-9_-]+$/);
  });
});
