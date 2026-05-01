import { cookies } from "next/headers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSupabaseServerClient,
  hasSupabaseServerConfig,
} from "./server";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

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

function restoreSupabaseEnv() {
  for (const key of SUPABASE_ENV_KEYS) {
    const originalValue = originalEnv[key];

    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
}

describe("Supabase cookie server client", () => {
  afterEach(() => {
    vi.mocked(cookies).mockReset();
    restoreSupabaseEnv();
  });

  it("throws a stable error when server environment variables are missing", async () => {
    clearSupabaseEnv();

    expect(hasSupabaseServerConfig()).toBe(false);
    await expect(createSupabaseServerClient()).rejects.toThrow(
      "Supabase environment variables are not configured.",
    );
  });

  it("constructs a cookie server client when environment variables are present", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    vi.mocked(cookies).mockResolvedValue({
      getAll: vi.fn(() => []),
      set: vi.fn(),
    } as never);

    expect(hasSupabaseServerConfig()).toBe(true);
    await expect(createSupabaseServerClient()).resolves.toHaveProperty("auth");
    expect(cookies).toHaveBeenCalledOnce();
  });
});
