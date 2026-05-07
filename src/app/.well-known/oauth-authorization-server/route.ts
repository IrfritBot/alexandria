import { authorizationServerMetadata } from "../../../lib/oauth/metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(authorizationServerMetadata(request), {
    headers: {
      "cache-control": "no-store",
    },
  });
}
