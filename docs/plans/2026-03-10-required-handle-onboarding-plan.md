# Required Handle Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Require every account to have a unique NOJV handle before using authenticated product surfaces, while allowing OAuth sign-in to create an incomplete account that must finish onboarding.

**Architecture:** Make `User.handle` nullable at the data layer so OAuth users can be created without a completed NOJV handle. Use Better Auth's official `username` plugin, mapped onto the existing `handle` column, so signup/update validation, normalization, and uniqueness stay inside the supported integration path. Enforce completion centrally in server auth boundaries: locale page requests redirect incomplete users to a dedicated onboarding page, and authenticated APIs reject incomplete users. Email/password signup continues to collect the handle up front and therefore lands in a complete state immediately.

**Tech Stack:** Next.js 16 App Router, Better Auth, Prisma 7, PostgreSQL, Vitest, Playwright

---

### Task 1: Lock onboarding rules with failing tests

**Files:**

- Create: `apps/web/tests/handle-onboarding.test.ts`
- Modify: `apps/web/tests/auth-config.test.ts`

**Step 1: Write the failing tests**

Add tests that prove:

- `requireAuth()` redirects incomplete users to `/auth/complete-profile`
- `requireAuth()` allows complete users through unchanged
- `withAuth()` returns `403` for authenticated users whose `handle` is missing
- Better Auth config no longer marks `handle` as required

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @nojv/web test tests/handle-onboarding.test.ts tests/auth-config.test.ts
```

Expected: failures showing current code still treats `handle` as always present and does not enforce onboarding completion.

**Step 3: Commit**

```bash
git add apps/web/tests/handle-onboarding.test.ts apps/web/tests/auth-config.test.ts
git commit -m "test: capture required handle onboarding behavior"
```

---

### Task 2: Make handle nullable in the data and auth model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_make_user_handle_nullable/migration.sql`
- Modify: `apps/web/src/lib/auth.ts`
- Delete: `apps/web/src/lib/auth-handle.ts`
- Delete: `apps/web/tests/auth-handle.test.ts`

**Step 1: Update schema and auth config**

Change `User.handle` to `String? @unique` in Prisma and add a nullable `displayHandle` column for Better Auth's official username plugin mapping. In Better Auth config, remove the custom `handle` additional field and register the official `username` plugin with schema mapping (`username -> handle`, `displayUsername -> displayHandle`) and handle validation.

**Step 2: Create migration**

Run:

```bash
cd packages/db && pnpm db:migrate --name make-user-handle-nullable
```

Expected: Prisma creates a migration that drops the `NOT NULL` requirement while keeping uniqueness.

**Step 3: Regenerate Prisma client**

Run:

```bash
pnpm --filter @nojv/db db:generate
```

Expected: generated client reflects nullable `handle`.

**Step 4: Commit**

```bash
git add packages/db/prisma apps/web/src/lib/auth.ts
git rm apps/web/src/lib/auth-handle.ts apps/web/tests/auth-handle.test.ts
git commit -m "refactor: model handle as required onboarding data"
```

---

### Task 3: Add centralized completion helpers and guards

**Files:**

- Create: `apps/web/src/lib/auth-onboarding.ts`
- Modify: `apps/web/src/lib/server/actor-context.ts`
- Modify: `apps/web/src/lib/server/authorization/guards.ts`
- Modify: `apps/web/src/lib/server/api-handler.ts`

**Step 1: Write minimal implementation**

Create a small auth-onboarding helper module that:

- normalizes the session user handle
- answers whether the account is complete
- exposes the completion route constant

Update server auth mapping so `ActorContext.handle` becomes `string | null`. `requireAuth()` should redirect incomplete users to `/auth/complete-profile` unless already on an auth/onboarding route. `withAuth()` / `withAuthParams()` should return `403` with a clear message for incomplete users.

**Step 2: Run focused tests**

Run:

```bash
pnpm --filter @nojv/web test tests/handle-onboarding.test.ts
```

Expected: onboarding guard tests pass.

**Step 3: Commit**

```bash
git add apps/web/src/lib/auth-onboarding.ts apps/web/src/lib/server/actor-context.ts apps/web/src/lib/server/authorization/guards.ts apps/web/src/lib/server/api-handler.ts
git commit -m "feat: enforce handle completion in auth guards"
```

---

### Task 4: Build the completion page and route-aware redirect flow

**Files:**

- Create: `apps/web/src/app/auth/complete-profile/page.tsx`
- Modify: `apps/web/src/proxy.ts`
- Modify: `apps/web/src/app/[locale]/layout.tsx`
- Modify: `apps/web/src/app/auth/signin/page.tsx`
- Modify: `apps/web/src/app/auth/signup/page.tsx`

**Step 1: Surface the onboarding page**

Create a dedicated completion page that:

- requires an authenticated session
- redirects complete users back to `/`
- renders the current name/email
- lets the user submit a valid handle via `authClient.updateUser({ username })`
- refreshes and routes to `/` after success

**Step 2: Propagate pathname for page gating**

Extend the existing `next-intl` proxy so it preserves locale behavior and also forwards the current pathname in a request header. In locale layout, if the session is authenticated but incomplete, redirect to `/auth/complete-profile`.

**Step 3: Make OAuth callbacks land on onboarding**

Set social sign-in callback URLs to `/auth/complete-profile` so the first post-OAuth landing point is deterministic.

**Step 4: Run focused tests**

Run:

```bash
pnpm --filter @nojv/web test tests/handle-onboarding.test.ts tests/auth-route.test.ts tests/auth-config.test.ts
```

Expected: auth integration tests stay green while onboarding rules pass.

**Step 5: Commit**

```bash
git add apps/web/src/app/auth/complete-profile/page.tsx apps/web/src/proxy.ts apps/web/src/app/[locale]/layout.tsx apps/web/src/app/auth/signin/page.tsx apps/web/src/app/auth/signup/page.tsx
git commit -m "feat: add required handle completion flow"
```

---

### Task 5: Clean dependent types and verify

**Files:**

- Modify: any files that still assume `ActorContext.handle` is always a string

**Step 1: Run typecheck and adjust**

Run:

```bash
pnpm --filter @nojv/web typecheck
```

Update any affected code to respect the invariant that authenticated product code only receives actors with a completed handle after the guard layer.

**Step 2: Run final verification**

Run:

```bash
pnpm --filter @nojv/web test tests/handle-onboarding.test.ts tests/auth-route.test.ts tests/auth-config.test.ts
pnpm --filter @nojv/web typecheck
pnpm --filter @nojv/db db:generate
```

Expected: all commands exit `0`.

**Step 3: Commit**

```bash
git add apps/web packages/db/prisma docs/plans/2026-03-10-required-handle-onboarding-plan.md
git commit -m "feat: require handle onboarding before authenticated use"
```
