import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AuthPanel,
  getAuthErrorMessage,
  requestEmailMagicLink,
  requestGoogleOAuth,
} from "./auth-panel";

function mockAuthClient() {
  const signInWithOAuth = vi.fn(async () => ({ error: null }));
  const signInWithOtp = vi.fn(async () => ({ error: null }));

  return {
    auth: {
      signInWithOAuth,
      signInWithOtp,
    },
    signInWithOAuth,
    signInWithOtp,
  };
}

describe("AuthPanel", () => {
  it("renders login copy with unified Google continuation text", () => {
    const html = renderToString(
      <AuthPanel
        callbackUrl="https://alexandria.test/auth/callback?next=%2F"
        mode="login"
      />,
    );

    expect(html).toContain("Log in to Alexandria");
    expect(html).toContain("Use your email or Google to continue.");
    expect(html).toContain("Send login link");
    expect(html).toContain("Email login links are for existing Alexandria accounts.");
    expect(html).toContain("Continue with Google");
    expect(html).not.toContain("Sign in with Google");
    expect(html).toContain('href="/signup"');
  });

  it("renders signup copy with the same unified Google continuation text", () => {
    const html = renderToString(
      <AuthPanel
        callbackUrl="https://alexandria.test/auth/callback?next=%2F"
        mode="signup"
      />,
    );

    expect(html).toContain("Create your Alexandria account");
    expect(html).toContain("Create your account with email or Google.");
    expect(html).toContain("Send signup link");
    expect(html).toContain("Continue with Google");
    expect(html).toContain('href="/login"');
  });

  it("renders controlled callback errors", () => {
    const html = renderToString(
      <AuthPanel
        callbackUrl="https://alexandria.test/auth/callback?next=%2F"
        initialError="exchange_failed"
        mode="login"
      />,
    );

    expect(html).toContain("That auth link could not be verified. Try again.");
    expect(getAuthErrorMessage("unknown")).toBe(
      "Authentication failed. Try again.",
    );
  });

  it("submits email login without silently creating users", async () => {
    const supabase = mockAuthClient();
    const callbackUrl = "https://alexandria.test/auth/callback?next=%2F";

    await requestEmailMagicLink({
      callbackUrl,
      email: "person@example.com",
      mode: "login",
      supabase,
    });

    expect(supabase.signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: {
        emailRedirectTo: callbackUrl,
        shouldCreateUser: false,
      },
    });
  });

  it("submits email signup with account creation enabled", async () => {
    const supabase = mockAuthClient();
    const callbackUrl = "https://alexandria.test/auth/callback?next=%2F";

    await requestEmailMagicLink({
      callbackUrl,
      email: "person@example.com",
      mode: "signup",
      supabase,
    });

    expect(supabase.signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: {
        emailRedirectTo: callbackUrl,
        shouldCreateUser: true,
      },
    });
  });

  it("starts Google OAuth through the shared callback URL", async () => {
    const supabase = mockAuthClient();
    const callbackUrl =
      "https://alexandria.test/auth/callback?next=%2Fworkspaces%2Fnew";

    await requestGoogleOAuth({
      callbackUrl,
      supabase,
    });

    expect(supabase.signInWithOAuth).toHaveBeenCalledWith({
      options: {
        redirectTo: callbackUrl,
      },
      provider: "google",
    });
  });
});
