# NOJV Project Optimization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all hardcoded demo data, make every page fully DB-driven, redesign the frontend to be a clean OJ (remove verbose portfolio-style descriptions), and set up Playwright E2E tests with screenshot verification.

**Architecture:** The seed script already inserts all data into PostgreSQL. We remove the demo-data.ts and course-poc-data.ts files, update read-model.ts to query DB without fallback, add DB queries for contests and integrity cases, simplify all page UI, and add Playwright E2E tests.

**Tech Stack:** Next.js 16, Prisma, Playwright, TypeScript, Tailwind CSS 4

---

## Phase 1: Remove Demo Data & Make Everything DB-Driven

### Task 1: Enhance seed with testcase sets for ALL problems

Currently only `warmup-sum` has testcases in seed. Add testcases for all 5 problems.

**Files:**

- Modify: `packages/db/prisma/seed.ts`

**Step 1: Add testcase sets for all problems**

Add sample + hidden testcase sets for `graph-docking`, `distributed-labyrinth`, `process-log-parser`, `fork-bomb-safeguard` in seed.ts, following the same pattern used for `warmup-sum`.

**Step 2: Add English (en) problem statements**

Currently only zh-TW statements are seeded. Add English statements as well.

**Step 3: Run seed and verify**

Run: `pnpm db:seed`
Expected: All 5 problems have testcase sets and bilingual statements.

**Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat: add testcase sets and en statements for all seeded problems"
```

---

### Task 2: Move shared types and starter templates out of demo-data

**Files:**

- Create: `apps/web/src/lib/problem-types.ts` (types + starterByLanguage)
- Modify: `apps/web/src/lib/server/read-model.ts` (import from new location)
- Modify: `apps/web/src/components/problem-editor.tsx` (import ProblemDetail from new location)

**Step 1: Create `problem-types.ts`**

Move `ProblemDetail` interface, `ContestDetail` interface, and `starterByLanguage` constant from `demo-data.ts` to a new file. These are not demo data - they're type definitions and default code templates.

**Step 2: Update all imports**

Update `read-model.ts`, `problem-editor.tsx`, and any other files that import `ProblemDetail` or `starterByLanguage` from `demo-data.ts`.

**Step 3: Verify build**

Run: `pnpm typecheck`
Expected: No errors.

**Step 4: Commit**

```bash
git commit -m "refactor: extract shared types and starter templates from demo-data"
```

---

### Task 3: Make contest pages DB-driven

Contest list and detail pages currently read from `contestCards` / `getContestDetail` in demo-data.ts. Make them query the database.

**Files:**

- Modify: `apps/web/src/lib/server/read-model.ts` (add `listContestCards()` and `getContestPageData()`)
- Modify: `apps/web/src/app/[locale]/contests/page.tsx`
- Modify: `apps/web/src/app/[locale]/contests/[slug]/page.tsx`
- Modify: `apps/web/src/app/[locale]/problems/[slug]/page.tsx` (contest context)

**Step 1: Add contest read-model functions**

```typescript
export async function listContestCards() {
  return prisma.contest.findMany({
    include: {
      problems: { select: { id: true } }
    },
    orderBy: { startsAt: "desc" },
    where: { visibility: "published" }
  });
}

export async function getContestPageData(slug: string) {
  return prisma.contest.findUnique({
    include: {
      problems: {
        include: { problem: true },
        orderBy: { ordinal: "asc" }
      }
    },
    where: { slug }
  });
}
```

**Step 2: Update contests/page.tsx**

Replace `contestCards` import with `listContestCards()` DB call. Add `export const dynamic = "force-dynamic"`.

**Step 3: Update contests/[slug]/page.tsx**

Replace `getContestDetail()` with `getContestPageData()` DB call. Add `export const dynamic = "force-dynamic"`.

**Step 4: Update problems/[slug]/page.tsx**

Replace `getContestDetail()` import to use the new DB query.

**Step 5: Verify**

Run: `pnpm typecheck`
Expected: No errors.

**Step 6: Commit**

```bash
git commit -m "feat: make contest pages fully DB-driven"
```

---

### Task 4: Make integrity page DB-driven

**Files:**

- Modify: `apps/web/src/lib/server/read-model.ts` (add `listIntegrityCases()`)
- Modify: `apps/web/src/app/[locale]/integrity/page.tsx`
- Modify: `apps/web/src/app/[locale]/page.tsx` (dashboard integrity section)

**Step 1: Add integrity read-model function**

```typescript
export async function listIntegrityCases() {
  return prisma.cheatingCase.findMany({
    orderBy: { openedAt: "desc" },
    take: 20
  });
}
```

**Step 2: Update integrity/page.tsx**

Replace `integrityCases` import. Handle empty state (no cases yet).

**Step 3: Update dashboard homepage**

Replace hardcoded integrity cases and queue series with DB queries or empty state.

**Step 4: Commit**

```bash
git commit -m "feat: make integrity page and dashboard DB-driven"
```

---

### Task 5: Remove demo-data fallbacks from read-model.ts

**Files:**

- Modify: `apps/web/src/lib/server/read-model.ts`

**Step 1: Remove mergeBySlug usage**

`listProblemCards()` and `listCourseCards()` should only return DB results, not merge with seeded arrays.

**Step 2: Remove demo-data fallbacks in getProblemPageData()**

If a problem isn't in DB, return null (not fallback to getProblemDetail).

**Step 3: Remove demo-data fallbacks in getCoursePageData()**

If a course isn't in DB, return null (not fallback to getCourseDetail).

**Step 4: Remove demo-data fallbacks from all helper functions**

`calculateAcceptanceRate`, `pickProblemStatement`, `buildProblemSamples`, etc. should not reference `getProblemDetail()` for fallback data.

**Step 5: Verify**

Run: `pnpm typecheck && pnpm test`

**Step 6: Commit**

```bash
git commit -m "refactor: remove demo-data fallbacks from read-model"
```

---

### Task 6: Remove demo-data fallbacks from poc-persistence.ts

**Files:**

- Modify: `apps/web/src/lib/server/poc-persistence.ts`

**Step 1: Remove imports from demo-data and course-poc-data**

`ensureProblem` should not reference `getProblemDetail()` for fallback metadata. `ensureContest` should not call `getContestDetail()`. `seedCourseIfKnown` and related should not reference `getCourseDetail()`.

**Step 2: Simplify ensureProblem**

It should only upsert with the provided input parameters, not fall back to demo data.

**Step 3: Remove ensureContest, seedCourseIfKnown, ensureCourseAssessment lazy-seeding**

These functions should only look up existing DB records, not create from demo data.

**Step 4: Verify**

Run: `pnpm typecheck && pnpm test`

**Step 5: Commit**

```bash
git commit -m "refactor: remove demo-data fallbacks from poc-persistence"
```

---

### Task 7: Delete demo-data files

**Files:**

- Delete: `apps/web/src/lib/demo-data.ts`
- Delete: `apps/web/src/lib/course-poc-data.ts`

**Step 1: Delete both files**

**Step 2: Verify no remaining imports**

Run: `grep -r "demo-data\|course-poc-data" apps/web/src/`
Expected: No matches.

**Step 3: Full project verify**

Run: `pnpm typecheck && pnpm test`

**Step 4: Commit**

```bash
git commit -m "chore: remove demo-data.ts and course-poc-data.ts"
```

---

## Phase 2: Frontend Redesign — Clean OJ UI

### Task 8: Simplify layout/header

**Files:**

- Modify: `apps/web/src/app/[locale]/layout.tsx`

**Step 1: Clean up header**

- Remove "Claude-native OJ Surface" subtitle — just show "NOJV"
- Remove the "NOJV / Online Judge" eyebrow
- Tighten navigation layout
- Keep: nav links, locale switcher, auth menu, dev role switcher

**Step 2: Commit**

```bash
git commit -m "ui: simplify header to clean OJ branding"
```

---

### Task 9: Redesign homepage/dashboard

**Files:**

- Modify: `apps/web/src/app/[locale]/page.tsx`

**Step 1: Remove verbose portfolio content**

Remove:

- "Execution Backbone" / "Queue health across product zones" section with MetricTrendChart
- "Architecture" card ("Next.js for the platform, Vite for the IDE...")
- "Evidence-first reviewer pipeline" card
- Hardcoded "Queues / min: 149" metric
- Hardcoded "Isolation: Docker" metric

**Step 2: Keep functional dashboard content**

Keep but simplify:

- Hero section (shorter, no technical pitch)
- Problem list preview (link to problems)
- Contest list preview (link to contests)
- Course list preview (link to courses)

**Step 3: Add real DB-driven metrics**

Show actual counts from DB: problem count, submission count, course count.

**Step 4: Commit**

```bash
git commit -m "ui: redesign homepage as clean functional dashboard"
```

---

### Task 10: Simplify problems pages

**Files:**

- Modify: `apps/web/src/app/[locale]/problems/page.tsx`
- Modify: `apps/web/src/app/[locale]/problems/[slug]/page.tsx`

**Step 1: Problems list — remove verbose description**

Remove the long paragraph ("Practice problems are modeled separately from contest participation. Every practice submission can still reuse the same judge pipeline..."). Keep only the page title.

**Step 2: Problem detail — remove verbose descriptions**

Remove "Execution guarantees" sidebar card with technical descriptions. Remove "LeetCode-style editing without file uploads" subtitle. Keep functional elements: editor, testcase panel, submission verdict.

**Step 3: Commit**

```bash
git commit -m "ui: simplify problem pages, remove verbose descriptions"
```

---

### Task 11: Simplify contest pages

**Files:**

- Modify: `apps/web/src/app/[locale]/contests/page.tsx`
- Modify: `apps/web/src/app/[locale]/contests/[slug]/page.tsx`

**Step 1: Contests list — remove verbose description**

Remove the paragraph about "Contest space is isolated from practice mode by data model and policy..." Keep only page title and contest cards.

**Step 2: Contest detail — remove verbose sidebars**

Remove "Why a distinct zone?" section. Simplify workspace policy description. Keep: contest problems, timeline, scoreboard info.

**Step 3: Commit**

```bash
git commit -m "ui: simplify contest pages"
```

---

### Task 12: Simplify courses and integrity pages

**Files:**

- Modify: `apps/web/src/app/[locale]/courses/page.tsx`
- Modify: `apps/web/src/app/[locale]/integrity/page.tsx`

**Step 1: Courses list — remove verbose description**

Remove "Course management adds teacher workflows on top of the judge backbone..." Keep title and course cards.

**Step 2: Integrity page — remove verbose description**

Remove "Anti-cheat is an evidence graph, not a checkbox..." paragraph. Keep functional case list and runtime stats.

**Step 3: Commit**

```bash
git commit -m "ui: simplify courses and integrity pages"
```

---

### Task 13: Update i18n copy

**Files:**

- Modify: `packages/i18n/src/index.ts`

**Step 1: Update hero copy**

Replace long technical taglines with shorter OJ-appropriate copy.

**Step 2: Verify**

Run: `pnpm typecheck`

**Step 3: Commit**

```bash
git commit -m "i18n: update copy to match clean OJ UI"
```

---

## Phase 3: E2E Tests with Playwright

### Task 14: Set up Playwright

**Files:**

- Modify: `apps/web/package.json` (add playwright deps)
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/` directory

**Step 1: Install Playwright**

```bash
cd apps/web && pnpm add -D @playwright/test
```

**Step 2: Create playwright.config.ts**

Configure with:

- baseURL: http://localhost:3000
- screenshot on failure
- screenshot directory: `e2e/screenshots/`
- webServer: start next dev (or expect already running)

**Step 3: Add test script**

Add `"test:e2e": "playwright test"` to apps/web/package.json.

**Step 4: Commit**

```bash
git commit -m "chore: set up Playwright for E2E tests"
```

---

### Task 15: E2E test — Auth flow

**Files:**

- Create: `apps/web/e2e/auth.spec.ts`

**Step 1: Write sign-in test**

- Navigate to `/auth/signin`
- Screenshot the sign-in page
- Fill in email/password (use seeded user: `amelia.chen@nojv.local` / `password123`)
- Submit form
- Verify redirect to homepage
- Screenshot authenticated state

**Step 2: Write sign-up test**

- Navigate to `/auth/signup`
- Screenshot the sign-up page
- Verify form elements present

**Step 3: Run test**

Run: `cd apps/web && npx playwright test e2e/auth.spec.ts`

**Step 4: Commit**

```bash
git commit -m "test(e2e): add auth flow tests with screenshots"
```

---

### Task 16: E2E test — Problems browsing

**Files:**

- Create: `apps/web/e2e/problems.spec.ts`

**Step 1: Write problems list test**

- Navigate to `/zh-TW/problems`
- Screenshot the problem list
- Verify problem cards are visible (at least 3 public problems)
- Click on "Warmup Sum" problem

**Step 2: Write problem detail test**

- Navigate to `/zh-TW/problems/warmup-sum`
- Screenshot the problem detail page
- Verify title, difficulty, editor are visible
- Verify testcase samples are shown

**Step 3: Run test**

Run: `cd apps/web && npx playwright test e2e/problems.spec.ts`

**Step 4: Commit**

```bash
git commit -m "test(e2e): add problem browsing tests with screenshots"
```

---

### Task 17: E2E test — Contests browsing

**Files:**

- Create: `apps/web/e2e/contests.spec.ts`

**Step 1: Write contests list test**

- Navigate to `/zh-TW/contests`
- Screenshot contests page
- Verify contest cards visible

**Step 2: Write contest detail test**

- Navigate to `/zh-TW/contests/spring-qualifier-2026`
- Screenshot contest detail
- Verify problems listed, timeline shown

**Step 3: Run test and commit**

```bash
git commit -m "test(e2e): add contest browsing tests with screenshots"
```

---

### Task 18: E2E test — Courses browsing

**Files:**

- Create: `apps/web/e2e/courses.spec.ts`

**Step 1: Write courses list test**

- Navigate to `/zh-TW/courses`
- Screenshot courses page
- Verify course cards visible

**Step 2: Write course detail test**

- Navigate to `/zh-TW/courses/os-lab-spring-2026`
- Screenshot course detail
- Verify assessments, members, problems visible

**Step 3: Run test and commit**

```bash
git commit -m "test(e2e): add course browsing tests with screenshots"
```

---

### Task 19: E2E test — Navigation and locale switching

**Files:**

- Create: `apps/web/e2e/navigation.spec.ts`

**Step 1: Write navigation test**

- Navigate to `/zh-TW`
- Screenshot homepage
- Click each nav link, verify page loads
- Switch locale to `en`, verify content changes
- Screenshot English homepage

**Step 2: Write submissions page test (auth-gated)**

- Navigate to `/zh-TW/submissions` without auth
- Verify sign-in required message
- Screenshot unauthenticated state

**Step 3: Run test and commit**

```bash
git commit -m "test(e2e): add navigation and locale tests with screenshots"
```

---

### Task 20: Fix any broken tests

**Step 1: Run all existing unit tests**

Run: `pnpm test`

Fix any tests broken by removing demo-data imports.

**Step 2: Run full verification**

Run: `pnpm typecheck && pnpm test`

**Step 3: Commit any fixes**

```bash
git commit -m "fix: update unit tests for DB-driven data model"
```
