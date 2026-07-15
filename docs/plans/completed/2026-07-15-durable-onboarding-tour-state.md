# Durable Onboarding Tour State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the automatic student or teacher welcome tour only once per account, while keeping explicit replay available without resetting durable state.

**Architecture:** PostgreSQL is the source of truth through role-specific `studentTourSeenAt` and `teacherTourSeenAt` fields. The dashboard claims an unseen tour through an authenticated endpoint before playing the single welcome intro; existing accounts are grandfathered by migration, students with submissions are ineligible, and manual replay keeps only session-local progress.

**Tech Stack:** Prisma/PostgreSQL, SvelteKit, Svelte 5, driver.js, Vitest.

---

### Task 1: Lock the behavior with tests

**Files:**

- Create: `tests/unit/web/onboarding-engine.test.ts`
- Create: `tests/unit/web/onboarding-tour-api.test.ts`

**Steps:**

1. Test that an automatic tour runs only after its server claim returns `true`.
2. Test that manual replay does not read, clear, or write `localStorage`.
3. Test that the API claims only stored student/teacher roles and excludes admins.
4. Run `pnpm exec vitest run tests/unit/web/onboarding-engine.test.ts tests/unit/web/onboarding-tour-api.test.ts --project unit` and verify the new tests fail before implementation.

### Task 2: Add durable role-specific state

**Files:**

- Modify: `packages/db/prisma/schema/auth.prisma`
- Create: `packages/db/prisma/migrations/20260716000019_durable_onboarding_tour_state/migration.sql`
- Modify: `packages/db/src/repositories/user.ts`
- Modify: `packages/application/src/user/mutations.ts`

**Steps:**

1. Add nullable `studentTourSeenAt` and `teacherTourSeenAt` timestamps.
2. Backfill the relevant timestamp for every existing student and teacher so the feature is not retroactive.
3. Add an atomic role-aware claim that updates only a null timestamp and reports whether this request won the claim.
4. Export the application mutation used by the web endpoint.
5. Run `pnpm db:generate`, `pnpm db:validate`, and `pnpm lint:migrations`.

### Task 3: Separate automatic and manual tour modes

**Files:**

- Modify: `apps/web/src/lib/onboarding/engine.ts`
- Modify: `apps/web/src/lib/onboarding/student-tour.ts`
- Modify: `apps/web/src/lib/onboarding/teacher-tour.ts`
- Modify: `apps/web/src/routes/(app)/+layout.svelte`
- Modify: `apps/web/src/routes/(app)/settings/+page.svelte`

**Steps:**

1. Delete all localStorage seen/off state and user-id keying.
2. Keep in-memory seen keys only after the user explicitly chooses replay.
3. Add `startAutomaticTour(intro, claim)`; it checks desktop eligibility and rendered steps, then plays only when the server claim succeeds.
4. Keep route navigation hooks solely for an active manual replay session.
5. Export explicit student and teacher welcome intros and remove user IDs from replay calls.

### Task 4: Claim the welcome tour from the dashboard

**Files:**

- Create: `apps/web/src/routes/api/account/onboarding-tour/+server.ts`
- Modify: `apps/web/src/routes/(app)/dashboard/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/dashboard/+page.svelte`

**Steps:**

1. Return automatic-tour eligibility only for a null role-specific timestamp; students must also have zero submissions.
2. Claim the stored role through the authenticated write endpoint and return `{ show: boolean }`.
3. On dashboard mount, claim and run only the matching welcome intro.
4. Fail quietly without a client fallback when the claim request fails; the server timestamp remains authoritative.

### Task 5: Remove obsolete test bypasses and verify

**Files:**

- Modify: `packages/db/prisma/seeds/users.ts`
- Modify: `tests/setup/playwright-global-setup.ts`
- Modify: `tests/e2e/editorials.test.ts`
- Modify: `tests/e2e/_disposable-user.ts`

**Steps:**

1. Mark seeded and disposable E2E users as already seen on their stored role.
2. Delete `nojv:tour:off` and `nojv:tour:seen:*` browser overrides.
3. Run focused unit tests, onboarding registry tests, formatting, lint, typechecks, and `pnpm ci:verify`.
4. Confirm `git status` contains only intended source, migration, test, and completed-plan changes.
