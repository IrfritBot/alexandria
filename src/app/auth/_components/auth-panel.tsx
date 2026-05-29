"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import type { AuthMode } from "@/lib/auth/auth-page";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import styles from "./auth-panel.module.css";

type AuthActionError = {
  message?: string;
};

type AuthActionResult = {
  error: AuthActionError | null;
};

type AuthActionClient = {
  auth: {
    signInWithOAuth(input: {
      options: {
        redirectTo: string;
      };
      provider: "google";
    }): Promise<AuthActionResult>;
    signInWithOtp(input: {
      email: string;
      options: {
        emailRedirectTo: string;
        shouldCreateUser: boolean;
      };
    }): Promise<AuthActionResult>;
  };
};

type AuthPanelCopy = {
  emailButton: string;
  emailHint: string;
  linkHref: string;
  linkText: string;
  sentMessage: string;
  subtitle: string;
  title: string;
};

const COPY: Record<AuthMode, AuthPanelCopy> = {
  login: {
    emailButton: "Send login link",
    emailHint: "Email login links are for existing Alexandria accounts.",
    linkHref: "/signup",
    linkText: "Create an account",
    sentMessage: "Check your email for a secure login link.",
    subtitle: "Use your email or Google to continue.",
    title: "Log in to Alexandria",
  },
  signup: {
    emailButton: "Send signup link",
    emailHint: "We will email you a secure link to finish setup.",
    linkHref: "/login",
    linkText: "Log in instead",
    sentMessage: "Check your email for a secure signup link.",
    subtitle: "Create your account with email or Google.",
    title: "Create your Alexandria account",
  },
};

const ERROR_MESSAGES: Record<string, string> = {
  exchange_failed: "That auth link could not be verified. Try again.",
  logout_failed: "We could not fully sign you out. Try again.",
  missing_code: "That auth link is missing a code. Try again.",
  profile_sync_failed: "We could not finish setting up your profile.",
};

export function getAuthPanelCopy(mode: AuthMode) {
  return COPY[mode];
}

export function getAuthErrorMessage(error: string | null | undefined) {
  if (!error) {
    return null;
  }

  return ERROR_MESSAGES[error] ?? "Authentication failed. Try again.";
}

export async function requestEmailMagicLink({
  callbackUrl,
  email,
  mode,
  supabase,
}: {
  callbackUrl: string;
  email: string;
  mode: AuthMode;
  supabase?: AuthActionClient;
}) {
  const client =
    supabase ?? (createSupabaseBrowserClient() as unknown as AuthActionClient);

  return client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl,
      shouldCreateUser: mode === "signup",
    },
  });
}

export async function requestGoogleOAuth({
  callbackUrl,
  supabase,
}: {
  callbackUrl: string;
  supabase?: AuthActionClient;
}) {
  const client =
    supabase ?? (createSupabaseBrowserClient() as unknown as AuthActionClient);

  return client.auth.signInWithOAuth({
    options: {
      redirectTo: callbackUrl,
    },
    provider: "google",
  });
}

export function AuthPanel({
  callbackUrl,
  initialError,
  mode,
}: {
  callbackUrl: string;
  initialError?: string | null;
  mode: AuthMode;
}) {
  const copy = getAuthPanelCopy(mode);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [googleStatus, setGoogleStatus] = useState<
    "idle" | "starting" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(
    getAuthErrorMessage(initialError),
  );
  const isBusy = emailStatus === "sending" || googleStatus === "starting";

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailStatus("sending");
    setErrorMessage(null);

    try {
      const { error } = await requestEmailMagicLink({
        callbackUrl,
        email,
        mode,
      });

      if (error) {
        setEmailStatus("error");
        setErrorMessage(error.message ?? "Unable to send magic link.");
        return;
      }

      setEmailStatus("sent");
    } catch {
      setEmailStatus("error");
      setErrorMessage("Unable to send magic link.");
    }
  }

  async function handleGoogleClick() {
    setGoogleStatus("starting");
    setErrorMessage(null);

    try {
      const { error } = await requestGoogleOAuth({ callbackUrl });

      if (error) {
        setGoogleStatus("error");
        setErrorMessage(error.message ?? "Unable to start Google auth.");
        return;
      }
    } catch {
      setGoogleStatus("error");
      setErrorMessage("Unable to start Google auth.");
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="auth-title">
        <Link className={styles.brand} href="/" aria-label="Alexandria home">
          <span className={styles.brandMark}>A</span>
          <span>Alexandria</span>
        </Link>
        <div className={styles.heading}>
          <h1 id="auth-title">{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>

        <button
          className={styles.googleButton}
          type="button"
          disabled={isBusy}
          onClick={handleGoogleClick}
        >
          {googleStatus === "starting" ? "Continuing..." : "Continue with Google"}
        </button>

        <div className={styles.divider} role="presentation">
          <span>or</span>
        </div>

        <form className={styles.form} onSubmit={handleEmailSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className={styles.hint}>{copy.emailHint}</p>
          <button type="submit" disabled={isBusy}>
            {emailStatus === "sending" ? "Sending..." : copy.emailButton}
          </button>
        </form>

        {emailStatus === "sent" ? (
          <p className={styles.status} role="status">
            {copy.sentMessage}
          </p>
        ) : null}
        {errorMessage ? (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        ) : null}

        <p className={styles.switcher}>
          <Link href={copy.linkHref}>{copy.linkText}</Link>
        </p>
      </section>
    </main>
  );
}
