import { MEMORY_PROCESS_REQUESTED_EVENT } from "../mcp/memory-save";
import { inngest } from "../inngest/client";
import { createConfiguredClassifier } from "./classifier";
import { createConfiguredEmbedder } from "./embedder";
import { processMemory } from "./processing";
import { createSupabaseMemoryProcessingDatabase } from "./processing-store";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventData(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.memory_id !== "string" ||
    typeof value.workspace_id !== "string"
  ) {
    return null;
  }

  return {
    mcpKeyId: typeof value.mcp_key_id === "string" ? value.mcp_key_id : null,
    memoryId: value.memory_id,
    workspaceId: value.workspace_id,
  };
}

export const processMemoryFunction = inngest.createFunction(
  {
    id: "memory-process-v1",
    name: "Memory Process v1",
    triggers: [{ event: MEMORY_PROCESS_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const data = eventData(event.data);

    if (!data) {
      return { ok: true, reason: "invalid_event", status: "skipped" };
    }

    return step.run("classify-embed-conflict-finalize", async () =>
      processMemory(data, {
        classifier: createConfiguredClassifier(),
        database: createSupabaseMemoryProcessingDatabase(),
        embedder: createConfiguredEmbedder(),
      }),
    );
  },
);

export const memoryInngestFunctions = [processMemoryFunction];
