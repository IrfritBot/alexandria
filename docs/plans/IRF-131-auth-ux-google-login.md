# IRF-131: Alexandria Auth UX + Google Login Implementation Plan

**Goal:** Upgrade Alexandria's human auth path from a minimal magic-link form to proper login and signup screens with Supabase Auth and Google OAuth.

**Architecture:** Keep the existing Supabase SSR cookie client, `/auth/callback` code exchange, `ensure_profile` RPC, workspace RLS, and MCP OAuth continuation path. Add a shared auth UI/client component that supports email magic links and Google OAuth, with separate `/login` and `/signup` entry points that differ in copy and email-account-creation behavior but return through the same safe callback route.

**Constraints:**
- DO NOT replace Supabase Auth or introduce a second auth provider.
- DO NOT weaken `getSafeNext()` or break `/oauth/authorize?...` login continuations for MCP OAuth.
- DO NOT use `service_role` for user-profile or workspace bootstrap.
- DO NOT commit Google OAuth secrets.
- DO NOT mutate production Supabase or Google provider config until Henry explicitly approves that runtime/auth change.
- DO NOT change MCP API-key or OAuth bearer-token behavior.
- DO NOT claim Google OAuth can enforce "existing user only" on `/login`; Supabase OAuth is a unified provider entry point unless we add a separate invite/allowlist gate.

## Product Decision: Google OAuth Semantics

Google OAuth is a unified `Continue with Google` path on both `/login` and `/signup`. Email magic-link login uses `shouldCreateUser: false`; email signup uses `shouldCreateUser: true`. Google OAuth does not get labeled as `Sign in with Google` on `/login` because a first-time Google user may create a Supabase Auth user when provider signup is enabled. If Alexandria later needs invite-only or closed beta enforcement, add an explicit Supabase Auth hook or post-callback access gate as a separate task.

---

## Task 1: Shared auth callback URL helper

**Files:**
- Create: `src/lib/auth/auth-callback-url.ts`
- Create: `src/lib/auth/auth-callback-url.test.ts`
- Modify: `src/app/login/page.tsx`

**Steps:**
- [ ] Write tests for building `/auth/callback?next=...` from a browser origin and raw `next` value.
- [ ] Implement `buildAuthCallbackUrl(origin: string, rawNext: string | null)` using `getSafeNext()` internally.
- [ ] Preserve valid internal paths and the existing OAuth authorize continuation.
- [ ] Reject malicious/external `next` values through the existing safe-next rules.
- [ ] Replace the local `getForwardedNext()`/callback construction in `src/app/login/page.tsx` with the helper.
- [ ] Add a test proving `/oauth/authorize?client_id=...&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=...` survives callback URL construction unchanged except for safe encoding.

**Expected behavior:** Email and OAuth sign-in paths share one redirect builder, so future auth screens cannot accidentally bypass redirect safety.

---

## Task 2: Shared auth panel with email and Google provider actions

**Files:**
- Create: `src/app/auth/_components/auth-panel.tsx`
- Create: `src/app/auth/_components/auth-panel.module.css`
- Create: `src/app/auth/_components/auth-panel.test.tsx`
- Modify: `src/app/login/page.tsx`
- Create: `src/app/signup/page.tsx`

**Steps:**
- [ ] Create a client component `AuthPanel` with `mode: "login" | "signup"`.
- [ ] Email login calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: false } })`.
- [ ] Email signup calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: true } })`.
- [ ] Google button calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl } })`.
- [ ] Google button text is `Continue with Google` in both modes, not `Sign in with Google` on login, because provider auth may create a new Supabase user when signup is enabled.
- [ ] Show deterministic loading, sent, and error states.
- [ ] Keep screen copy product-grade but short: no help-center wall of text.
- [ ] Add tests for mode-specific copy and button/form behavior with a mocked browser Supabase client, including the explicit Google unified-entry semantics.

**Expected behavior:** `/login` and `/signup` both support email and Google. Email login does not silently create new users; Google is intentionally presented as a unified provider continuation.

---

## Task 3: Auth page server wrappers and signed-in redirect

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/signup/page.tsx`
- Create: `src/lib/auth/auth-page.ts`
- Create: `src/lib/auth/auth-page.test.ts`
- Update: `src/app/auth/callback/route.test.ts`

**Steps:**
- [ ] Convert `/login` and `/signup` pages into server wrappers that check `supabase.auth.getUser()`.
- [ ] If already signed in, redirect to the validated `next` path, falling back to `/`.
- [ ] If signed out, render `AuthPanel`.
- [ ] Keep `/auth/callback` as the only code exchange and profile-sync route.
- [ ] Add callback tests proving Google-style metadata (`full_name`, `name`) still syncs `profiles.display_name`.
- [ ] Add a signed-in redirect test for an MCP OAuth continuation: `/login?next=/oauth/authorize?...redirect_uri=https%3A%2F%2F...` redirects back to the safe authorize URL and does not collapse to `/`.

**Expected behavior:** Auth pages do not show to already signed-in users, and provider users still leave callback with a synced profile.

---

## Task 4: Sign-out route and session lifecycle

**Files:**
- Create: `src/app/logout/route.ts`
- Create: `src/app/logout/route.test.ts`
- Modify: `src/app/page.tsx`
- Update: `src/app/page.test.tsx`

**Steps:**
- [ ] Implement `POST /logout` using `createSupabaseServerClient().auth.signOut()`.
- [ ] Redirect to `/login` after sign-out.
- [ ] Ignore arbitrary external return paths; use `getSafeNext()` only if the final UI needs a safe post-logout continuation.
- [ ] Add a sign-out control to the signed-in home/dashboard branch.
- [ ] Test successful sign-out and controlled error behavior.

**Expected behavior:** Human auth has a complete session lifecycle: login/signup/callback/sign-out.

---

## Task 5: Google provider configuration documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `supabase/config.toml`

**Steps:**
- [ ] Document the required Supabase Google provider setup:
  - Google Cloud OAuth client ID/secret.
  - Supabase Auth provider enabled for Google.
  - Redirect allow-list must include the deployed `/auth/callback` origin/path and local dev callback.
- [ ] Add `.env.example` placeholders for local Supabase CLI provider secrets only; leave values blank.
- [ ] Add a disabled or commented Google provider config block to `supabase/config.toml` with env-secret placeholders so local developers know the exact shape.
- [ ] Document exactly how local Supabase CLI receives those env vars before `supabase start` / `supabase db reset`, for example exporting `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in the shell or using the project's local env-loading convention.
- [ ] State that production provider enablement is a manual runtime/auth change requiring approval and secret injection outside git.

**Expected behavior:** Code supports Google OAuth, and deployment has clear secret/config instructions without leaking credentials or breaking local Supabase startup.

---

## Task 6: Verification

**Files:**
- Update: `README.md`
- Update: relevant tests from Tasks 1-5

**Steps:**
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test`.
- [ ] Run `npm run build`.
- [ ] Manually smoke local `/login` and `/signup` rendering.
- [ ] Manually smoke `/logout` from a signed-in local session.
- [ ] Verify the MCP OAuth continuation path by starting `/oauth/authorize` while signed out, passing through `/login`, and confirming the final callback returns to `/oauth/authorize` rather than `/`.
- [ ] If Google provider credentials are not configured, verify the button surfaces a controlled Supabase error instead of crashing.

**Expected behavior:** Existing magic-link auth remains intact, Google OAuth initiation is wired, and auth UI changes are covered by focused tests.

---

## Rollback Plan

Revert the IRF-131 commit. Because production Supabase/Google provider enablement is out of scope until separately approved, rollback should not require provider-side changes unless Henry later approves runtime config changes.
