import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { memoryInngestFunctions } from "@/lib/memory/inngest";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: memoryInngestFunctions,
});
