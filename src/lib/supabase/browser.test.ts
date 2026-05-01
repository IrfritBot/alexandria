import { afterEach, describe, expect, it } from "vitest";

import {
  createSupabaseBrowserClient,
  hasSupabaseBrowserConfig,
} from "./browser";

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

describe("Supabase browser client", () => {
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

  it("throws a stable error when browser environment variables are missing", () => {
    clearSupabaseEnv();

    expect(hasSupabaseBrowserConfig()).toBe(false);
    expect(() => createSupabaseBrowserClient()).toThrow(
      "Supabase environment variables are not configured.",
    );
  });

  it("constructs a browser client when environment variables are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    expect(hasSupabaseBrowserConfig()).toBe(true);
    expect(createSupabaseBrowserClient().auth).toBeDefined();
  });
});
