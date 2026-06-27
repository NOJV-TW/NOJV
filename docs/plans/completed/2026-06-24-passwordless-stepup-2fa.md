# Passwordless Step-up + Passkey + Account Linking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the low-entropy email-OTP 2FA-enrollment gate (which needs the `API_TOKEN_PEPPER`) with a provider-independent design — a unified enrollment gate (fresh-session + high-entropy email confirm link + change notification), step-up via an enrolled factor (TOTP now, passkey added), and profile-page account linking — then remove the pepper entirely.

**Architecture:** Sensitive actions (create API token, enroll/disable 2FA, link/unlink a provider) require a _fresh step-up_. Step-up is proven by an **enrolled strong factor** (TOTP via better-auth `twoFactor`; passkey via `@better-auth/passkey`), which is provider-independent and therefore works identically for Google and GitHub logins. The _first_ factor enrollment (bootstrap) is gated by a **fresh session** (better-auth `freshAge`) + a **high-entropy email confirmation link** (sha256-at-rest, no pepper, GET-peek/POST-confirm like `verify-school`) + a **notification email** on every factor/link change. Because no path uses a low-entropy secret anymore, `API_TOKEN_PEPPER` is deleted; the API-token hash drops from HMAC-pepper to plain `sha256`.

**Tech Stack:** SvelteKit form actions, better-auth 1.6.17 (`twoFactor` already enabled; `freshAge`/`freshSessionMiddleware`; account `/link-social`, `/list-accounts`, `/unlink-account`; `@better-auth/passkey` to be added), `@nojv/redis`, `node:crypto` (`randomBytes` + `createHash`), existing mailer seam (`getMailer()`), Prisma 7.

---

## Threat model (why this is at least as strong as today)

| Moment                                  | Today (email OTP + pepper)               | This plan                                                                                                                                    |
| --------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Step-up** (factor exists)             | TOTP/backup via better-auth              | Same — TOTP/passkey, on a **separate device**; strictly ≥ email OTP (email is often open in the same browser on a shared PC)                 |
| **First-factor enrollment** (bootstrap) | low-entropy email OTP (pepper-protected) | fresh-session gate + **high-entropy** email confirm link (no pepper) + notification                                                          |
| **Detection / recovery**                | none beyond OTP                          | **notification email on every factor/link change** + revocable; the real net for "no gate is perfect"                                        |
| **API token at rest**                   | `randomBytes` + `HMAC(sha256, pepper)`   | `randomBytes` + plain `sha256` (high-entropy → pepper redundant; CodeQL `js/insufficient-password-hash` already dismissed as false-positive) |

Provider asymmetry (Google can `prompt=login`, GitHub cannot) is sidestepped: the enrolled factor is **our** credential, not the OAuth provider's, so one unified flow serves both.

## Decisions (locked in discussion)

- Do **not** persist the school email; keep only the OAuth account email (`user.email`). School email = one-time student-identity check.
- Unified enrollment gate for both providers (email is the common denominator); use a **high-entropy link**, not a low-entropy OTP → pepper-free.
- Step-up factor: **TOTP first** (already wired), **passkey added** this cycle.
- Account linking from the profile page; `allowDifferentEmails: true`; block linking an already-claimed identity (better-auth default); prevent unlinking the **last** login method.
- Remove `API_TOKEN_PEPPER` end-to-end; API-token hash → plain `sha256`.

## Out of scope (explicit)

- **Account merging** (combining two existing separate accounts / their submissions/history). Today username-uniqueness already blocks a second account from claiming a verified student; linking is the _preventive_ path, merging is the _remedial_ one — deferred.
- Persisting/standardizing the school email as a sendable address.
- OAuth `prompt=login` re-auth step-up (Google-only → breaks the unified-flow requirement; rejected).

## Migration / breaking notes

- **Existing API tokens become invalid** when `hashToken` switches HMAC→sha256 (HMAC output ≠ sha256 output, and HMAC is not reversible). Users must re-issue. Acceptable at current stage; call it out in the PR description. No data migration needed (the `tokenHash` column type is unchanged).
- **In-flight enrollment OTPs** (Redis `twoFactorEnrollOtp:*`) are abandoned; the new link flow supersedes them. TTL expires them; no cleanup migration needed.
- `API_TOKEN_PEPPER` removal touches env schema + deploy. Removing a _required_ env from `env-manifest-parity` must land in the same commit as the schema change or the parity test fails.

## Current call sites (grounding)

- `apps/web/src/lib/server/step-up.ts` — `hashOtp`/`generateOtp`/`storeEnrollOtp`/`verifyEnrollOtp` (pepper user #2), `markStepUpFresh`/`hasFreshStepUp` (Redis gate), `verifyStepUpCode` (TOTP/backup).
- `packages/application/src/api-token/lifecycle.ts` — `hashToken` (pepper user #1), `apiTokenPepper()`.
- `apps/web/src/lib/server/shared/step-up.ts` consumers:
  - `routes/(app)/account/api-tokens/+page.server.ts` — gates token CRUD with `hasFreshStepUp`.
  - `routes/(app)/account/api-tokens/verify/+page.server.ts` — `verifyStepUpCode` → `markStepUpFresh`.
  - `routes/(app)/account/two-factor/+page.server.ts` — enrollment via `generateOtp`/`storeEnrollOtp`/`verifyEnrollOtp` (the path to replace).

---

## Phase 1 — API-token hash: HMAC-pepper → plain SHA256

Removes pepper user #1. Self-contained; no dependency on later phases.

### Task 1.1: Switch `hashToken` to plain sha256

**Files:**

- Modify: `packages/application/src/api-token/lifecycle.ts` (import line 1; `hashToken` ~136-138; delete `DEV_API_TOKEN_PEPPER`, `apiTokenPepper` — _but see Phase 3: `apiTokenPepper` is also imported by `step-up.ts`; keep the export until Phase 2 removes that consumer, then delete in Phase 3_).
- Test: `tests/unit/domain/api-token-lifecycle.test.ts`

**Step 1 — Failing test:** assert a created token round-trips through verify, and that the stored hash equals `createHash('sha256').update(token).digest('base64url')` (no pepper). Update/replace the existing pepper-config test (lines ~281-293) to expect **no** `API_TOKEN_PEPPER` requirement for tokens.

**Step 2:** Run `pnpm --filter @nojv/application test -- api-token-lifecycle` → expect FAIL.

**Step 3 — Implement:** `import { createHash, randomBytes, timingSafeEqual } from "node:crypto"`; `hashToken` → `return createHash("sha256").update(token).digest("base64url");`. Leave `apiTokenPepper` exported for now (still used by step-up.ts).

**Step 4:** Run the test → PASS. Then `pnpm --filter @nojv/application typecheck`.

**Step 5 — Commit:** `feat(api-token): hash tokens with plain sha256 (256-bit random secret needs no pepper)`

---

## Phase 2 — Replace email-OTP enrollment gate with high-entropy confirm link + freshAge + notification

Removes pepper user #2. This is the security core.

### Task 2.1: Enrollment-confirm token module (pepper-free)

**Files:**

- Create: `apps/web/src/lib/server/two-factor-enroll.ts`
- Test: `tests/integration/two-factor-enroll.test.ts` (Redis-backed)

Design mirrors `verify-school`: `randomBytes(32)` token; store `sha256(token)` in Redis under `keys.twoFactorEnrollConfirm(userId)` with TTL; `peek(token)` (read-only) + `consume(userId, token)` (timing-safe compare + delete). **No pepper.** Add the Redis key to `@nojv/redis` key registry.

TDD steps: failing test for generate→store→peek→consume happy path + wrong-token + expired; implement; pass; commit `feat(2fa): pepper-free high-entropy enroll-confirm token`.

### Task 2.2: Fresh-session gate helper

**Files:**

- Modify: `apps/web/src/lib/auth.server.ts` — add `session: { freshAge: <e.g. 60*15> }` (confirm exact option path in 1.6.17 `init-options`).
- Create/modify: `apps/web/src/lib/server/step-up.ts` — `requireFreshSession(event)` helper (reuse `freshSessionMiddleware` semantics or check `session.createdAt`).

Decide freshAge window (recommend 15 min). Test the helper rejects a stale session, accepts a fresh one.

### Task 2.3: New enrollment flow in the 2FA route

**Files:**

- Modify: `apps/web/src/routes/(app)/account/two-factor/+page.server.ts` (replace `generateOtp`/`storeEnrollOtp`/`verifyEnrollOtp` usage at ~111-134) and `+page.svelte`.
- Create: enrollment-confirm landing route (GET peek + POST confirm), e.g. `routes/(auth)/two-factor-confirm/+page.server.ts` + `+page@.svelte` (clone the `verify-school` peek/confirm pattern).
- Modify: mailer call — send to `user.email` (the OAuth account email).

Flow: (1) user (fresh session) requests 2FA enroll → email a high-entropy confirm link; (2) link → GET peek landing page → POST confirm → marks enrollment allowed; (3) better-auth TOTP enrollment proceeds; (4) send notification email "a 2FA factor was added".

### Task 2.4: Remove the email-OTP functions

Delete `hashOtp`, `generateOtp`, `storeEnrollOtp`, `verifyEnrollOtp`, `OTP_*` constants from `step-up.ts`; remove `twoFactorEnrollOtp` Redis key if now unused. Verify no remaining importers (`grep`). Commit.

---

## Phase 3 — Delete the pepper end-to-end

Only after Phases 1-2 leave `apiTokenPepper()` with zero callers.

**Files (remove `API_TOKEN_PEPPER` / `apiTokenPepper`):**

- `packages/application/src/api-token/lifecycle.ts` — delete `apiTokenPepper`, `DEV_API_TOKEN_PEPPER`, `ConfigurationError` import if now unused; drop the barrel export in `packages/application/src/index.ts`.
- `apps/web/src/lib/server/env.ts` (env schema) — remove `API_TOKEN_PEPPER`.
- `.env.example`, `docker-compose.yml:158`, `infra/gcp/cloud-build/deploy.sh:88,114,126`, `infra/gcp/web.cloudrun.yaml:52`, `.github/workflows/deploy.yml:57,76,88`.
- `tests/unit/infra/env-manifest-parity.test.ts:131,141` — drop from required-env lists (**same commit** as env schema change).
- `docs/operations/DEPLOYMENT.md:51,278,590` — remove rows.
- `docs/plans/active/2026-06-23-api-token-step-up-2fa-implementation.md` — note superseded (or move to completed).

**Verify:** `grep -rIn "API_TOKEN_PEPPER\|apiTokenPepper" --exclude-dir=node_modules .` returns nothing. Run `pnpm test:unit` (env-manifest-parity must pass). Commit `chore(auth): remove API_TOKEN_PEPPER — no low-entropy secret remains`.

---

## Phase 4 — Account linking from the profile page

### Task 4.1: Enable cross-provider linking

**Files:** `apps/web/src/lib/auth.server.ts:115` — `accountLinking: { enabled: true, trustedProviders: ["github","google"], allowDifferentEmails: true }`.

### Task 4.2: Profile UI + actions

**Files:**

- Modify: `routes/(app)/account/+page.server.ts` + `+page.svelte` (or a dedicated `account/connections/` route).
- Use better-auth `/list-accounts` (show linked providers), `/link-social` (link; OAuth round-trip), `/unlink-account` (unlink).

**Guards (must add — better-auth won't decide these):**

- Link/unlink require fresh step-up + send notification email.
- Block unlinking the **last** remaining login method (query `/list-accounts`; if unlink would leave 0 providers and no password, refuse).
- Already-claimed identity → surface better-auth's link error as a friendly "this Google/GitHub account already belongs to another NOJV account."

TDD: integration tests for link happy path, already-claimed rejection, last-method-unlink rejection.

---

## Phase 5 — Passkey as a step-up factor (new dependency)

> **Spike first:** confirm the package for better-auth 1.6.17 — `better-auth/plugins/passkey` did **not** resolve from the core package in this repo; it is likely the separate `@better-auth/passkey`. Confirm name/version, peer deps, and DB model before Task 5.1.

### Task 5.1: Add plugin + schema

- Add dep `@better-auth/passkey` (or confirmed name); register `passkey()` plugin in `auth.server.ts`.
- Generate Prisma migration for the passkey table (better-auth schema). `pnpm db:generate` + migration file under `packages/db/prisma/migrations/`.

### Task 5.2: Enrollment + authentication (WebAuthn) frontend

- Register: `generatePasskeyRegistrationOptions` → browser WebAuthn create → verify. Gate behind the Phase-2 enrollment gate.
- Step-up: `generatePasskeyAuthenticationOptions` (works for signed-in users — confirmed in better-auth docs) → browser get → verify → `markStepUpFresh`.

### Task 5.3: Offer passkey OR TOTP at enrollment and step-up

- Update `two-factor` enroll UI and `api-tokens/verify` step-up UI to accept either factor.
- Recovery: ensure backup codes remain available (better-auth `twoFactor`) so a lost passkey/authenticator isn't a lockout.

---

## Testing strategy

- Unit: `pnpm --filter @nojv/application test` (Phase 1), helper units.
- Integration (Redis): enroll-confirm token, link guards (`pnpm test:integration`).
- Full gate before each commit per `superpowers:test-driven-development`; `pnpm ci:verify` before the PR.
- Manual: real OAuth (Google + GitHub) enroll → step-up → link/unlink, per `verify` skill, before merge. 2FA paths historically surface real bugs only end-to-end.

## Sequencing rationale

Phases 1→2→3 are the contained, high-value core (pepper removal, unified gate) and should land/verify first. Phase 4 (linking) is largely better-auth-provided. Phase 5 (passkey) is the largest (new dep + migration + WebAuthn) and goes last so the foundation is proven before adding surface area.
