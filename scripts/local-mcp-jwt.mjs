#!/usr/bin/env node

import { createHmac } from "node:crypto";

const secret = process.env.SUPABASE_JWT_SECRET;

if (!secret) {
  console.error("Set SUPABASE_JWT_SECRET from `supabase status`.");
  process.exit(1);
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const now = Math.floor(Date.now() / 1000);
const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
const payload = base64UrlJson({
  exp: now + 60 * 60 * 24 * 365,
  iat: now,
  iss: "supabase",
  role: "mcp_session_executor",
});
const signature = createHmac("sha256", secret)
  .update(`${header}.${payload}`)
  .digest("base64url");

console.log(`${header}.${payload}.${signature}`);
