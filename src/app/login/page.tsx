"use client";

import { type FormEvent, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function getForwardedNext() {
  if (typeof window === "undefined") {
    return "/";
  }

  return new URLSearchParams(window.location.search).get("next") ?? "/";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");

    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", getForwardedNext());

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
      },
    });

    setStatus(error ? "error" : "sent");
  }

  return (
    <main>
      <section aria-labelledby="login-title">
        <h1 id="login-title">Sign in</h1>
        <form onSubmit={handleSubmit}>
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
          <button type="submit" disabled={status === "sending"}>
            Send magic link
          </button>
        </form>
        {status === "sent" ? <p role="status">check your email</p> : null}
        {status === "error" ? (
          <p role="alert">Unable to send magic link.</p>
        ) : null}
      </section>
    </main>
  );
}
