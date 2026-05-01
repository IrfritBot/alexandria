import { afterEach, describe, expect, it } from "vitest";

import { createSupabaseServerClient, hasSupabaseConfig } from "./client";

const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const originalEnv = Object.fromEntries(
  SUPABASE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearSupabaseEnv() {
  for (const key of SUPABASE_ENV_KEYS) {
    delete process.env[key];
  }
}

describe("Supabase anon server client", () => {
  afterEach(() => {
    for (const key of SUPABASE_ENV_KEYS) {
      const originalValue = originalEnv[key];

      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it("throws a stable error when anon environment variables are missing", () => {
    clearSupabaseEnv();

    expect(hasSupabaseConfig()).toBe(false);
    expect(() => createSupabaseServerClient()).toThrow(
      "Supabase environment variables are not configured.",
    );
  });
});
