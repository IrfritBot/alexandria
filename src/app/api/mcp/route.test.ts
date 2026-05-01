import { describe, expect, it } from "vitest";

import { GET, POST } from "./route";

const notImplementedPayload = {
  ok: false,
  service: "alexandria",
  surface: "mcp",
  status: "not_implemented",
  message:
    "MCP transport and memory tools are intentionally stubbed for Sprint 1A.",
};

async function expectNotImplementedResponse(response: Response) {
  await expect(response.json()).resolves.toEqual(notImplementedPayload);
  expect(response.status).toBe(501);
}

describe("mcp route", () => {
  it("returns the stable 501 contract for GET", async () => {
    await expectNotImplementedResponse(await GET());
  });

  it("returns the stable 501 contract for POST", async () => {
    await expectNotImplementedResponse(await POST());
  });
});
