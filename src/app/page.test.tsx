import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../lib/supabase/server";
import Home from "./page";

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

type WorkspaceMembership = {
  workspaces: {
    name: string;
    slug: string;
  } | null;
};

function mockSupabase({
  memberships = [],
  user,
}: {
  memberships?: WorkspaceMembership[] | null;
  user: { email: string | null } | null;
}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
  }));
  const overrideTypes = vi.fn(async () => ({
    data: memberships,
  }));
  const order = vi.fn(() => ({
    overrideTypes,
  }));
  const select = vi.fn(() => ({
    order,
  }));
  const from = vi.fn(() => ({
    select,
  }));

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser,
    },
    from,
  } as never);

  return {
    from,
    getUser,
    order,
    overrideTypes,
    select,
  };
}

describe("home page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the signed-out branch", async () => {
    const { from, getUser } = mockSupabase({
      user: null,
    });

    const html = renderToString(await Home());

    expect(getUser).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
    expect(html).toContain("Shared team memory");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in");
  });

  it("renders the signed-in branch with workspace memberships", async () => {
    const { from, order, overrideTypes, select } = mockSupabase({
      user: {
        email: "person@example.com",
      },
      memberships: [
        {
          workspaces: {
            name: "Alexandria Team",
            slug: "alexandria-team",
          },
        },
      ],
    });

    const html = renderToString(await Home());

    expect(from).toHaveBeenCalledWith("workspace_members");
    expect(select).toHaveBeenCalledWith("workspaces(name, slug)");
    expect(order).toHaveBeenCalledWith("joined_at", { ascending: true });
    expect(overrideTypes).toHaveBeenCalledOnce();
    expect(html).toContain("person@example.com");
    expect(html).toContain('href="/workspaces/new"');
    expect(html).toContain("Create workspace");
    expect(html).toContain("Your workspaces");
    expect(html).toContain("Alexandria Team");
    expect(html).toContain("alexandria-team");
    expect(html).toContain('href="/workspaces/alexandria-team"');
  });
});
