import "server-only";

import type { ValidMcpSession } from "./api-keys";
import { inngest } from "../inngest/client";
import { createSupabaseMcpExecutorClient } from "../supabase/mcp-executor";

const MAX_CONTENT_CHARS = 8192;
const MEMORY_SAVE_MESSAGE = "Memory accepted for processing.";

export const MEMORY_PROCESS_REQUESTED_EVENT = "memory/process.requested";

type SupabaseError = {
  code?: string;
  message?: string;
};

type RpcClient = {
  rpc(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: SupabaseError | null;
  }>;
};

type MemoryProcessingEventClient = {
  send(event: {
    name: typeof MEMORY_PROCESS_REQUESTED_EVENT;
    data: {
      memory_id: string;
      mcp_key_id: string;
      tags: string[];
      workspace_id: string;
    };
  }): Promise<unknown>;
};

export type MemorySaveField = "content" | "tags";

export type MemorySaveResult =
  | {
      ok: true;
      memoryId: string;
      message: typeof MEMORY_SAVE_MESSAGE;
      status: "processing";
    }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "invalid_mcp_session"
        | "save_failed"
        | "enqueue_failed";
      field?: MemorySaveField;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeMcpTag(tag: string) {
  return tag
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9:/-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
}

export function validateMemorySavePayload(
  payload: unknown,
):
  | {
      ok: true;
      content: string;
      tags: string[];
    }
  | {
      ok: false;
      field: MemorySaveField;
    } {
  if (!isRecord(payload) || typeof payload.content !== "string") {
    return { ok: false, field: "content" };
  }

  const content = payload.content.trim();

  if (content.length === 0 || content.length > MAX_CONTENT_CHARS) {
    return { ok: false, field: "content" };
  }

  if (payload.tags === undefined) {
    return { ok: true, content, tags: [] };
  }

  if (
    !Array.isArray(payload.tags) ||
    !payload.tags.every((tag): tag is string => typeof tag === "string")
  ) {
    return { ok: false, field: "tags" };
  }

  const seenTags = new Set<string>();
  const tags = payload.tags.flatMap((tag) => {
    const normalizedTag = normalizeMcpTag(tag);

    if (!normalizedTag || seenTags.has(normalizedTag)) {
      return [];
    }

    seenTags.add(normalizedTag);
    return [normalizedTag];
  });

  return { ok: true, content, tags };
}

function normalizeRpcRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

function mapRpcError(error: SupabaseError): MemorySaveResult {
  if (error.code === "42501") {
    return { ok: false, reason: "invalid_mcp_session" };
  }

  if (error.code === "22023") {
    if (error.message?.includes("invalid_input:tags")) {
      return { ok: false, reason: "invalid_input", field: "tags" };
    }

    return { ok: false, reason: "invalid_input", field: "content" };
  }

  return { ok: false, reason: "save_failed" };
}

export async function saveMcpMemory(
  payload: unknown,
  session: Pick<ValidMcpSession, "workspaceId" | "mcpKeyId">,
  dependencies?: {
    eventClient?: MemoryProcessingEventClient;
    rpcClient?: RpcClient;
  },
): Promise<MemorySaveResult> {
  const validation = validateMemorySavePayload(payload);

  if (!validation.ok) {
    return {
      ok: false,
      reason: "invalid_input",
      field: validation.field,
    };
  }

  let saveResponse: {
    data: unknown;
    error: SupabaseError | null;
  };

  try {
    const rpcClient =
      dependencies?.rpcClient ??
      ((createSupabaseMcpExecutorClient() as unknown) as RpcClient);

    saveResponse = await rpcClient.rpc("save_mcp_memory", {
      p_content: validation.content,
      p_mcp_key_id: session.mcpKeyId,
      p_tags: validation.tags,
      p_workspace_id: session.workspaceId,
    });
  } catch {
    return { ok: false, reason: "save_failed" };
  }

  const { data, error } = saveResponse;

  if (error) {
    return mapRpcError(error);
  }

  const [row] = normalizeRpcRows(data);

  if (typeof row?.memory_id !== "string" || row.status !== "processing") {
    return { ok: false, reason: "save_failed" };
  }

  const memoryId = row.memory_id;
  const eventClient =
    dependencies?.eventClient ?? (inngest as MemoryProcessingEventClient);

  try {
    await eventClient.send({
      data: {
        mcp_key_id: session.mcpKeyId,
        memory_id: memoryId,
        tags: validation.tags,
        workspace_id: session.workspaceId,
      },
      name: MEMORY_PROCESS_REQUESTED_EVENT,
    });
  } catch {
    return { ok: false, reason: "enqueue_failed" };
  }

  return {
    ok: true,
    memoryId,
    message: MEMORY_SAVE_MESSAGE,
    status: "processing",
  };
}
