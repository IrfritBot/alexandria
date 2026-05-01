import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
