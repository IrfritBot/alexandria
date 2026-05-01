import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("health route", () => {
  it("returns the Alexandria health payload", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: "alexandria",
    });
    expect(typeof body.timestamp).toBe("string");
  });
});
