# Supabase

Database changes live in `supabase/migrations/` as timestamped SQL files in the standard Supabase migration layout.

The initial migration creates only the Alexandria database surface from the locked schema plan: extensions, tables, constraints, indexes, the MCP session helper, and baseline RLS policies. API routes, auth flows, workers, search functions, and product logic belong outside this directory.

DB-layer validation SQL lives in `supabase/validation/` and is intended to run against a database after migrations have been applied.
