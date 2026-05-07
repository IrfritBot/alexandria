import "server-only";

import { createConfiguredClassifier } from "./classifier";
import { createConfiguredEmbedder } from "./embedder";
import { processMemory, type ProcessMemoryInput } from "./processing";
import { createSupabaseMemoryProcessingDatabase } from "./processing-store";

export async function processMemoryWithConfiguredDependencies(
  input: ProcessMemoryInput,
) {
  return processMemory(input, {
    classifier: createConfiguredClassifier(),
    database: createSupabaseMemoryProcessingDatabase(),
    embedder: createConfiguredEmbedder(),
  });
}
