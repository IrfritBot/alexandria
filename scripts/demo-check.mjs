#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_POLL_SECONDS = 90;

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function baseUrl() {
  return trimTrailingSlash(
    process.env.ALEXANDRIA_DEMO_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      DEFAULT_BASE_URL,
  );
}

function pollSeconds() {
  const value = Number.parseInt(
    process.env.ALEXANDRIA_DEMO_POLL_SECONDS || "",
    10,
  );

  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_POLL_SECONDS;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logOk(message) {
  console.log(`[ok] ${message}`);
}

function logInfo(message) {
  console.log(`[info] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requestUrl(path) {
  return new URL(path, `${baseUrl()}/`).toString();
}

async function fetchText(path, options = {}) {
  const expectedStatuses = options.expectedStatuses || [200];
  const response = await fetch(requestUrl(path), {
    headers: options.headers,
    method: options.method || "GET",
    redirect: options.redirect,
  });
  const text = await response.text();

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${options.method || "GET"} ${path} returned ${response.status}: ${text.slice(
        0,
        240,
      )}`,
    );
  }

  return { response, text };
}

async function fetchJson(path, options = {}) {
  const expectedStatuses = options.expectedStatuses || [200];
  const response = await fetch(requestUrl(path), {
    body: options.body,
    headers: {
      ...(options.headers || {}),
    },
    method: options.method || "GET",
    redirect: options.redirect,
  });
  const text = await response.text();

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${options.method || "GET"} ${path} returned ${response.status}: ${text.slice(
        0,
        240,
      )}`,
    );
  }

  try {
    return { body: JSON.parse(text), response };
  } catch {
    throw new Error(`${options.method || "GET"} ${path} did not return JSON.`);
  }
}

function mcpHeaders() {
  const key = process.env.ALEXANDRIA_DEMO_MCP_KEY;

  assert(
    key,
    "Set ALEXANDRIA_DEMO_MCP_KEY to a one-time key from /workspaces/[slug]/keys before running demo:check.",
  );

  return {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

async function mcpPost(method, params, expectedStatuses = [200]) {
  return fetchJson("/api/mcp", {
    body: JSON.stringify({ method, params }),
    expectedStatuses,
    headers: mcpHeaders(),
    method: "POST",
  });
}

async function waitForSearch(uniqueToken, memoryId) {
  const deadline = Date.now() + pollSeconds() * 1000;
  let lastTotal = 0;

  while (Date.now() < deadline) {
    const { body } = await mcpPost("memory_search", {
      limit: 5,
      query: uniqueToken,
    });

    assert(body.ok === true, "memory_search returned an unsuccessful payload.");
    lastTotal = Number.isInteger(body.total) ? body.total : 0;

    const memories = Array.isArray(body.memories) ? body.memories : [];
    const found = memories.find(
      (memory) =>
        memory &&
        (memory.memory_id === memoryId ||
          (typeof memory.content === "string" &&
            memory.content.includes(uniqueToken))),
    );

    if (found) {
      return found;
    }

    await sleep(3000);
  }

  throw new Error(
    `memory_save returned processing, but memory_search did not find the saved memory within ${pollSeconds()}s (last total: ${lastTotal}). Start the Inngest dev worker against ${baseUrl()}/api/inngest and retry.`,
  );
}

async function verifyWebBrowse(uniqueToken) {
  const slug = process.env.ALEXANDRIA_DEMO_WORKSPACE_SLUG;
  const cookie = process.env.ALEXANDRIA_DEMO_COOKIE;

  if (!slug || !cookie) {
    logInfo(
      "Skipped signed-in web browse automation. Set ALEXANDRIA_DEMO_WORKSPACE_SLUG and ALEXANDRIA_DEMO_COOKIE to include it.",
    );

    if (slug) {
      logInfo(
        `Manual browse check: open ${baseUrl()}/workspaces/${slug}/memories?q=${encodeURIComponent(
          uniqueToken,
        )} while signed in.`,
      );
    }

    return;
  }

  const headers = { cookie };

  const workspace = await fetchText(`/workspaces/${slug}`, {
    expectedStatuses: [200],
    headers,
    redirect: "manual",
  });
  assert(
    workspace.text.includes("Alexandria workspace"),
    "Workspace page did not render the authenticated shell.",
  );
  logOk("signed-in workspace page rendered");

  const memories = await fetchText(
    `/workspaces/${slug}/memories?q=${encodeURIComponent(uniqueToken)}`,
    {
      expectedStatuses: [200],
      headers,
      redirect: "manual",
    },
  );
  assert(
    memories.text.includes(uniqueToken),
    "Memories page did not render the saved demo memory.",
  );
  logOk("signed-in memories web browse rendered the saved memory");
}

async function main() {
  const uniqueToken = `alexandriademo${Date.now().toString(36)}${Math.random()
    .toString(16)
    .slice(2, 10)}`;
  const content = `Alexandria MVP demo policy ${uniqueToken}: team members must verify memory_save processing search and get before the MVP demo.`;

  const health = await fetchJson("/api/health");
  assert(health.body.ok === true, "Health endpoint returned an unhealthy body.");
  logOk(`health endpoint is live at ${baseUrl()}`);

  const login = await fetchText("/login");
  assert(login.text.includes("Sign in"), "Login page did not render.");
  logOk("login page rendered");

  const tools = await fetchJson("/api/mcp", {
    expectedStatuses: [200],
    headers: mcpHeaders(),
  });
  const toolNames = Array.isArray(tools.body.tools)
    ? tools.body.tools.map((tool) => tool.name)
    : [];
  for (const toolName of [
    "memory_save",
    "memory_search",
    "memory_recall_recent",
    "memory_get",
  ]) {
    assert(toolNames.includes(toolName), `MCP tool list is missing ${toolName}.`);
  }
  logOk("MCP key authenticated and tool catalog is complete");

  const save = await mcpPost(
    "memory_save",
    {
      content,
      tags: ["demo", "mvp"],
    },
    [202],
  );
  assert(save.body.status === "processing", "memory_save did not enter processing.");
  assert(
    typeof save.body.memory_id === "string",
    "memory_save did not return a memory_id.",
  );
  logOk(`memory_save accepted ${save.body.memory_id} for processing`);

  const found = await waitForSearch(uniqueToken, save.body.memory_id);
  logOk(`processing completed and memory_search found ${found.memory_id}`);

  const get = await mcpPost("memory_get", {
    memory_id: found.memory_id,
  });
  assert(get.body.ok === true, "memory_get returned an unsuccessful payload.");
  assert(
    typeof get.body.content === "string" && get.body.content.includes(uniqueToken),
    "memory_get did not return the saved content.",
  );
  logOk("memory_get returned the saved memory");

  await verifyWebBrowse(uniqueToken);

  logOk("demo check completed");
}

main().catch((error) => {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
