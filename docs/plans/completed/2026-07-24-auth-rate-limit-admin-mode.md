# Auth Rate Limit And Admin Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove deterministic first-use rate-limiter failures from 2FA actions and stop expected admin step-up navigation from emitting a 403.

**Architecture:** Keep Redis-backed production limits fail-closed, but make the first protected request explicitly await its dedicated lazy connection before consuming quota. Represent missing admin step-up as a successful API result with `verificationRequired: true`; callers must only navigate to `/admin` when `active` is true.

**Tech Stack:** SvelteKit, Svelte 5, ioredis, Vitest, Playwright.

---

### Task 1: Lock the regressions

**Files:**

- Modify: `tests/unit/web/rate-limiter.test.ts`
- Modify: `tests/e2e/admin.test.ts`

1. Add a unit test proving the first consume waits for a delayed Redis connection before running the limiter command.
2. Change the admin E2E expectation from a 403 control response to a 200 response with `{ active: false, verificationRequired: true }`.
3. Run the focused tests and confirm they fail against the current implementation.

### Task 2: Fix first-use limiter failures

**Files:**

- Modify: `apps/web/src/lib/server/shared/rate-limiter.ts`
- Modify: `tests/unit/web/rate-limiter.test.ts`
- Modify: `docs/architecture/REDIS.md`

1. Await a single shared initial connection before consuming quota.
2. Keep lazy connection, offline queuing disabled, and bounded retries unchanged.
3. Update the Redis architecture description to match the lazy, fail-closed implementation.
4. Run the focused rate-limiter unit test.

### Task 3: Make admin step-up an explicit result

**Files:**

- Modify: `apps/web/src/routes/api/admin-mode/+server.ts`
- Modify: `apps/web/src/lib/components/features/auth/UserMenu.svelte`
- Modify: `apps/web/src/routes/(app)/account/api-tokens/verify/+page.svelte`
- Modify: `tests/e2e/admin.test.ts`

1. Return `{ active: false, verificationRequired: true }` with HTTP 200 when fresh step-up is missing.
2. Redirect the user menu only when `verificationRequired` is true.
3. Require the passkey follow-up response to contain `active: true`.
4. Preserve direct privilege denial: the endpoint never activates admin mode without a valid fresh factor.

### Task 4: Verify

1. Run focused unit tests.
2. Run formatting, type checking, and the affected admin/2FA E2E tests.
3. Start the local web app and verify the user-visible paths after hydration.
