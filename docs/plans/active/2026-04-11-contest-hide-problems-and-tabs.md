# Contest Hide Problems + Participable/Managed Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide contest problems from non-managers until `startsAt`, and split `/contests` into *Participable* vs *Managed* tabs. Both features share one permission primitive (`canManageContest`: owner + course teacher + course TA).

**Architecture:**
- Permission logic lives in `packages/domain/src/contest/permissions.ts` as a pure function consumed by detail page, problem solve page, and list page.
- `getContestDetail` / `getContestWorkspaceData` are refactored to accept `{ userId, now }` and return `{ problems: ProblemSummary[] | null, problemsHidden: boolean, isManager: boolean }`. No Prisma schema or existing repo method changes; additive repo methods are added for the new list-page queries.
- Contest list page renders Bits UI Tabs with URL-synced state (`?tab=`).

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Prisma 7, Vitest (unit + integration with real Postgres), Playwright, Paraglide JS i18n, Bits UI, pnpm workspace monorepo.

**Spec:** `docs/superpowers/specs/2026-04-11-contest-hide-problems-and-tabs-design.md`

**File Structure:**

| File | Purpose |
|---|---|
| `packages/domain/src/contest/permissions.ts` *(new)* | Pure `canManageContest(userId, contest, memberships)` |
| `packages/domain/src/contest/queries.ts` *(modified)* | Refactor detail queries; add `listContestsForUser` |
| `packages/domain/src/contest/index.ts` *(modified)* | Export permissions module |
| `packages/db/src/repositories/contest.ts` *(modified)* | Additive: `listManagedForUser`, `listParticipableForUser` |
| `packages/db/src/repositories/course.ts` *(modified)* | Additive: `courseMembershipRepo.listActiveForUser` |
| `apps/web/src/routes/(app)/contests/+page.server.ts` *(modified)* | Call `listContestsForUser`, read `?tab=` |
| `apps/web/src/routes/(app)/contests/+page.svelte` *(modified)* | Bits UI Tabs, empty states, visibility badges |
| `apps/web/src/routes/(app)/contests/[slug]/+page.server.ts` *(modified)* | Pass `userId` + `now` to domain |
| `apps/web/src/routes/(app)/contests/[slug]/+page.svelte` *(modified)* | `{#if problemsHidden}` branch, manager link gate |
| `apps/web/src/routes/(app)/contests/[slug]/problems/[problemId]/+page.server.ts` *(modified)* | Admit managers before `startsAt` |
| `apps/web/messages/en.json` *(modified)* | 8 new keys |
| `apps/web/messages/zh-TW.json` *(modified)* | 8 new keys |
| `tests/unit/domain/contest-permissions.test.ts` *(new)* | `canManageContest` truth table |
| `tests/integration/domain/contest-visibility.test.ts` *(new)* | `getContestDetail` hide behavior |
| `tests/integration/domain/contest-list-for-user.test.ts` *(new)* | `listContestsForUser` classification |
| `tests/e2e/contest-hidden-problems.test.ts` *(new)* | Student sees placeholder; teacher sees problems |

---

## Task 1: Permission primitive — `canManageContest`

**Files:**
- Create: `packages/domain/src/contest/permissions.ts`
- Test: `tests/unit/domain/contest-permissions.test.ts`

- [ ] **Step 1.1: Write the failing unit test**

Create `tests/unit/domain/contest-permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { canManageContest } from "@nojv/domain";

const standalone = { createdByUserId: "owner-1", courseId: null };
const courseContest = { createdByUserId: "owner-1", courseId: "course-1" };

describe("canManageContest", () => {
  it("returns false for unauthenticated user", () => {
    expect(canManageContest(null, standalone, [])).toBe(false);
  });

  it("returns true when user is the contest creator", () => {
    expect(canManageContest("owner-1", standalone, [])).toBe(true);
  });

  it("returns false for a stranger on a standalone contest", () => {
    expect(canManageContest("stranger", standalone, [])).toBe(false);
  });

  it("returns true for an active teacher of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "teacher" as const, status: "active" as const }
    ];
    expect(canManageContest("teacher-1", courseContest, memberships)).toBe(true);
  });

  it("returns true for an active TA of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "ta" as const, status: "active" as const }
    ];
    expect(canManageContest("ta-1", courseContest, memberships)).toBe(true);
  });

  it("returns false for a student of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "student" as const, status: "active" as const }
    ];
    expect(canManageContest("student-1", courseContest, memberships)).toBe(false);
  });

  it("returns false for a removed teacher membership", () => {
    const memberships = [
      { courseId: "course-1", role: "teacher" as const, status: "removed" as const }
    ];
    expect(canManageContest("teacher-1", courseContest, memberships)).toBe(false);
  });

  it("returns false when teacher membership is for a different course", () => {
    const memberships = [
      { courseId: "course-other", role: "teacher" as const, status: "active" as const }
    ];
    expect(canManageContest("teacher-1", courseContest, memberships)).toBe(false);
  });

  it("returns false when standalone contest has no course to teach", () => {
    const memberships = [
      { courseId: "course-1", role: "teacher" as const, status: "active" as const }
    ];
    expect(canManageContest("teacher-1", standalone, memberships)).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm test:unit tests/unit/domain/contest-permissions.test.ts`
Expected: FAIL with "canManageContest is not exported from @nojv/domain".

- [ ] **Step 1.3: Create `permissions.ts` with minimal implementation**

Create `packages/domain/src/contest/permissions.ts`:

```ts
import type { CourseRole, CourseMembershipStatus } from "@nojv/db";

export type ContestPermissionInput = {
  createdByUserId: string;
  courseId: string | null;
};

export type CourseMembershipRow = {
  courseId: string;
  role: CourseRole;
  status: CourseMembershipStatus;
};

/**
 * True when the user may edit the contest, preview problems before start,
 * and see draft/archived versions. Used by detail page, problem solve page,
 * and the list page tab classifier.
 *
 * Pure — callers must fetch memberships and pass them in. This lets the
 * list page batch-resolve permissions for many contests without N+1.
 */
export function canManageContest(
  userId: string | null,
  contest: ContestPermissionInput,
  courseMemberships: CourseMembershipRow[]
): boolean {
  if (userId === null) return false;
  if (contest.createdByUserId === userId) return true;
  if (contest.courseId === null) return false;
  return courseMemberships.some(
    (m) =>
      m.courseId === contest.courseId &&
      m.status === "active" &&
      (m.role === "teacher" || m.role === "ta")
  );
}
```

- [ ] **Step 1.4: Re-export from contest barrel**

Modify `packages/domain/src/contest/index.ts` — add a line:

```ts
export * from "./queries";
export * from "./mutations";
export * from "./scoreboard";
export * from "./scoring";
export * from "./schemas";
export * from "./permissions";
```

- [ ] **Step 1.5: Run test to verify it passes**

Run: `pnpm test:unit tests/unit/domain/contest-permissions.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 1.6: Commit**

```bash
git add packages/domain/src/contest/permissions.ts \
        packages/domain/src/contest/index.ts \
        tests/unit/domain/contest-permissions.test.ts
git commit -m "feat(domain): add canManageContest permission primitive"
```

---

## Task 2: Additive repo method — `courseMembershipRepo.listActiveForUser`

**Files:**
- Modify: `packages/db/src/repositories/course.ts`

- [ ] **Step 2.1: Add the method**

In `packages/db/src/repositories/course.ts`, inside `courseMembershipRepo`, add (before `withTx`):

```ts
listActiveForUser(userId: string) {
  return prisma.courseMembership.findMany({
    where: { userId, status: "active" },
    select: { courseId: true, role: true, status: true }
  });
},
```

This returns `Array<{ courseId: string; role: CourseRole; status: "active" }>` — exactly the shape `canManageContest` expects.

- [ ] **Step 2.2: Run the typecheck**

Run: `pnpm --filter @nojv/db exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add packages/db/src/repositories/course.ts
git commit -m "feat(db): add courseMembershipRepo.listActiveForUser"
```

---

## Task 3: Refactor `getContestDetail` / `getContestWorkspaceData` to accept `{userId, now}`

**Files:**
- Modify: `packages/domain/src/contest/queries.ts`
- Test: `tests/integration/domain/contest-visibility.test.ts`

- [ ] **Step 3.1: Write the failing integration test**

Create `tests/integration/domain/contest-visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  createTestContest,
  createTestProblem,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { contestDomain } from "@nojv/domain";

const { getContestDetail } = contestDomain;

async function attachProblem(contestId: string, ordinal: number, points: number) {
  const problem = await createTestProblem();
  await testPrisma.contestProblem.create({
    data: { contestId, problemId: problem.id, ordinal, points }
  });
  return problem;
}

describe("getContestDetail visibility gating", () => {
  it("hides problems for a stranger before startsAt", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date("2099-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-02T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);

    const stranger = await createTestUser();
    const result = await getContestDetail(contest.slug, {
      userId: stranger.id,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result).not.toBeNull();
    expect(result!.problemsHidden).toBe(true);
    expect(result!.problems).toBeNull();
    expect(result!.isManager).toBe(false);
  });

  it("reveals problems for the contest creator before startsAt", async () => {
    const owner = await createTestUser();
    const contest = await createTestContest({
      visibility: "published",
      createdByUserId: owner.id,
      startsAt: new Date("2099-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-02T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);

    const result = await getContestDetail(contest.slug, {
      userId: owner.id,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result!.problemsHidden).toBe(false);
    expect(result!.problems).toHaveLength(1);
    expect(result!.isManager).toBe(true);
  });

  it("reveals problems to a course teacher before startsAt", async () => {
    const teacher = await createTestUser();
    const course = await testPrisma.course.create({
      data: {
        id: "course-visibility",
        slug: "course-visibility",
        title: "Visibility Course",
        description: "",
        locale: "en",
        visibility: "listed",
        ownerId: teacher.id
      }
    });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: teacher.id, role: "teacher", status: "active" }
    });
    const contest = await createTestContest({
      visibility: "published",
      courseId: course.id,
      startsAt: new Date("2099-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-02T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);

    const result = await getContestDetail(contest.slug, {
      userId: teacher.id,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result!.problemsHidden).toBe(false);
    expect(result!.isManager).toBe(true);
  });

  it("reveals problems to all viewers once the contest is active", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date("2020-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-01T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);
    const stranger = await createTestUser();

    const result = await getContestDetail(contest.slug, {
      userId: stranger.id,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result!.problemsHidden).toBe(false);
    expect(result!.problems).toHaveLength(1);
  });

  it("accepts unauthenticated callers (userId: null) and hides before start", async () => {
    const contest = await createTestContest({
      visibility: "published",
      startsAt: new Date("2099-01-01T00:00:00Z"),
      endsAt: new Date("2099-01-02T00:00:00Z")
    });
    await attachProblem(contest.id, 1, 100);

    const result = await getContestDetail(contest.slug, {
      userId: null,
      now: new Date("2026-01-01T00:00:00Z")
    });

    expect(result!.problemsHidden).toBe(true);
    expect(result!.problems).toBeNull();
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm test:integration tests/integration/domain/contest-visibility.test.ts`
Expected: FAIL — `getContestDetail` currently takes `(slug: string)`, and its return type lacks `problemsHidden`/`isManager`.

- [ ] **Step 3.3: Refactor `getContestDetail` and `getContestWorkspaceData`**

In `packages/domain/src/contest/queries.ts`:

1. Add imports at the top:

```ts
import { courseMembershipRepo } from "@nojv/db";
import { canManageContest } from "./permissions";
```

2. Extend the `ContestDetailData` interface with three new fields:

```ts
export interface ContestDetailData {
  // ...all existing fields unchanged...
  problems: {
    id: string;
    ordinal: number;
    points: number;
    title: string;
  }[] | null;       // ← was: [] without null
  problemsHidden: boolean;
  isManager: boolean;
}
```

3. Replace `getContestDetail` with the new signature:

```ts
export type ContestDetailOptions = {
  userId: string | null;
  now: Date;
};

export async function getContestDetail(
  contestSlug: string,
  options: ContestDetailOptions
): Promise<ContestDetailData | null> {
  const contest = await contestRepo.findDetailBySlug(contestSlug);
  if (contest?.visibility !== "published") return null;

  const memberships =
    options.userId === null
      ? []
      : await courseMembershipRepo.listActiveForUser(options.userId);

  const isManager = canManageContest(
    options.userId,
    { createdByUserId: contest.createdByUserId, courseId: contest.courseId },
    memberships
  );

  const problemsHidden = !isManager && options.now < contest.startsAt;

  const base = mapContestDetail(contest);
  return {
    ...base,
    isManager,
    problemsHidden,
    problems: problemsHidden ? null : base.problems
  };
}
```

4. Replace `getContestWorkspaceData` with the new signature (keeps `participation`):

```ts
export async function getContestWorkspaceData(
  contestSlug: string,
  userId: string,
  options: { now: Date }
): Promise<ContestWorkspaceData | null> {
  const contest = await contestRepo.findWorkspaceBySlug(contestSlug, userId);
  if (contest?.visibility !== "published") return null;

  const memberships = await courseMembershipRepo.listActiveForUser(userId);

  const isManager = canManageContest(
    userId,
    { createdByUserId: contest.createdByUserId, courseId: contest.courseId },
    memberships
  );

  const problemsHidden = !isManager && options.now < contest.startsAt;

  const base = mapContestDetail(contest);
  const participation = contest.participations[0] ?? null;

  return {
    ...base,
    isManager,
    problemsHidden,
    problems: problemsHidden ? null : base.problems,
    participation: participation
      ? {
          penaltySeconds: participation.penaltySeconds,
          score: participation.score,
          startedAt: participation.startedAt?.toISOString() ?? null,
          status: participation.status
        }
      : null
  };
}
```

5. Confirm `ContestWorkspaceData extends ContestDetailData` — the new fields (`problemsHidden`, `isManager`) and the `problems: ... | null` change are inherited automatically.

- [ ] **Step 3.4: Run the visibility test**

Run: `pnpm test:integration tests/integration/domain/contest-visibility.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3.5: Run the existing contest query tests**

Run: `pnpm test:integration tests/integration/domain/contests.test.ts`
Expected: Likely FAIL — existing tests call `getContestDetail("slug")` with one argument. These are existing tests; update each call site to pass `{ userId: null, now: new Date() }` or the intended fixture time. Do not change test intent; only adapt to the new signature.

- [ ] **Step 3.6: Run both together**

Run: `pnpm test:integration tests/integration/domain/contests.test.ts tests/integration/domain/contest-visibility.test.ts`
Expected: PASS.

- [ ] **Step 3.7: Commit**

```bash
git add packages/domain/src/contest/queries.ts \
        tests/integration/domain/contest-visibility.test.ts \
        tests/integration/domain/contests.test.ts
git commit -m "feat(domain): hide contest problems before startsAt for non-managers"
```

---

## Task 4: Detail page `+page.server.ts` — pass `userId` + `now`

**Files:**
- Modify: `apps/web/src/routes/(app)/contests/[slug]/+page.server.ts`

- [ ] **Step 4.1: Update the load function**

Replace the body of `load` to pass the new options object. Full replacement:

```ts
import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";
import { contestDomain, getClientIp } from "@nojv/domain";

const { getContestDetail, getContestParticipationForIpCheck, checkContestIpAccess } =
  contestDomain;

export const load: PageServerLoad = async ({ params, locals, request }) => {
  const now = new Date();
  const user = locals.user;

  const contest = await getContestDetail(params.slug, {
    userId: user?.id ?? null,
    now
  });

  if (!contest) {
    error(404, "Contest not found");
  }

  if (user && (contest.ipWhitelistEnabled || contest.ipBindingEnabled)) {
    const isActive = new Date(contest.startsAt) <= now && now <= new Date(contest.endsAt);

    if (isActive) {
      const clientIp = getClientIp(request);
      const participation = await getContestParticipationForIpCheck(contest.id, user.id);
      const ipResult = await checkContestIpAccess(
        contest,
        clientIp,
        contest.id,
        user.id,
        participation
      );

      if (!ipResult.allowed && contest.ipViolationMode === "block") {
        error(
          403,
          ipResult.violationType === "whitelist"
            ? "Your IP address is not in the allowed range for this contest."
            : "Your IP address does not match the one bound to your session."
        );
      }
    }
  }

  return { contest };
};
```

- [ ] **Step 4.2: Typecheck the web app**

Run: `pnpm --filter @nojv/web check`
Expected: pass. If the TS check complains about `contest.problems` being possibly null anywhere, note the line — it will be fixed in Task 6.

- [ ] **Step 4.3: Commit**

```bash
git add apps/web/src/routes/\(app\)/contests/\[slug\]/+page.server.ts
git commit -m "feat(web): pass userId and now to getContestDetail"
```

---

## Task 5: i18n — add 8 new message keys

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

- [ ] **Step 5.1: Add keys to `en.json`**

Insert alongside existing contest keys (sorted placement — `contestDetail_*` with other `contestDetail_*` keys; `contests_*` with other `contests_*` keys):

```json
"contestDetail_problemsHiddenTitle": "Problems are not yet available",
"contestDetail_problemsHiddenBody": "Problems will be revealed when the contest starts.",
"contests_tabParticipable": "Participable",
"contests_tabManaged": "My contests",
"contests_emptyParticipable": "No contests available right now.",
"contests_emptyManaged": "You don't manage any contests yet.",
"contests_visibilityDraft": "Draft",
"contests_visibilityArchived": "Archived"
```

- [ ] **Step 5.2: Add matching keys to `zh-TW.json`**

```json
"contestDetail_problemsHiddenTitle": "題目尚未公開",
"contestDetail_problemsHiddenBody": "本競賽的題目將於開始時公開。",
"contests_tabParticipable": "可參加的",
"contests_tabManaged": "我的競賽",
"contests_emptyParticipable": "目前沒有可參加的競賽。",
"contests_emptyManaged": "您還沒有主辦任何競賽。",
"contests_visibilityDraft": "草稿",
"contests_visibilityArchived": "已封存"
```

- [ ] **Step 5.3: Regenerate paraglide bindings**

Run: `pnpm --filter @nojv/web dev --prerun-only 2>/dev/null || pnpm --filter @nojv/web build`

(Paraglide regenerates `$lib/paraglide/messages.js` during build. If the project exposes a dedicated `paraglide:compile` script, prefer that; otherwise the first `dev`/`build` picks up changes.)

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/messages/en.json apps/web/messages/zh-TW.json
git commit -m "i18n(web): add contest hide-problems and tab keys"
```

---

## Task 6: Detail page `+page.svelte` — placeholder branch + manager link gate

**Files:**
- Modify: `apps/web/src/routes/(app)/contests/[slug]/+page.svelte`

- [ ] **Step 6.1: Add `Lock` icon import**

Near the existing lucide imports at the top of the `<script>` block, add:

```ts
import Lock from "lucide-svelte/icons/lock";
```

- [ ] **Step 6.2: Wrap the problems section in a conditional**

Find the current problems section (`{#each contest.problems as p (p.id)}` at ~line 145). Replace the `#each` block with:

```svelte
{#if data.contest.problemsHidden}
  <Card variant="surface" size="lg" class="flex flex-col items-center gap-3 text-center">
    <Lock class="h-6 w-6 text-muted-foreground" />
    <h2 class="font-display text-heading-sm">{m.contestDetail_problemsHiddenTitle()}</h2>
    <p class="text-body text-muted-foreground">{m.contestDetail_problemsHiddenBody()}</p>
    <p class="text-caption text-muted-foreground tabular-nums">
      {m.contests_startsIn()}: {startsIn}
    </p>
  </Card>
{:else}
  {#each data.contest.problems ?? [] as p (p.id)}
    {@const href =
      isActive || data.contest.isManager
        ? `/contests/${data.contest.slug}/problems/${p.id}`
        : null}
    {#if href}
      <a class="block" {href}>
        <Card
          variant="surface"
          size="md"
          interactive
          class="flex-row items-center justify-between"
        >
          <div class="flex items-center gap-3">
            <span
              class="flex h-8 w-8 items-center justify-center rounded-sm bg-muted font-display text-body-sm font-semibold text-muted-foreground"
            >
              {String.fromCharCode(64 + p.ordinal)}
            </span>
            <span class="font-medium text-body">{p.title}</span>
          </div>
          <span class="text-caption text-muted-foreground tabular-nums">
            {p.points}
            {m.contestDetail_pts()}
          </span>
        </Card>
      </a>
    {:else}
      <Card
        variant="flat"
        size="md"
        class="flex-row items-center justify-between opacity-60"
      >
        <div class="flex items-center gap-3">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-sm bg-muted font-display text-body-sm font-semibold text-muted-foreground"
          >
            {String.fromCharCode(64 + p.ordinal)}
          </span>
          <span class="font-medium text-body">{p.title}</span>
        </div>
        <span class="text-caption text-muted-foreground tabular-nums">
          {p.points}
          {m.contestDetail_pts()}
        </span>
      </Card>
    {/if}
  {/each}
{/if}
```

Notes:
- `startsIn` is the existing countdown string already computed in this file; keep its declaration intact.
- `data.contest.problems ?? []` defends the `#each` typing — when `problemsHidden` is false, `problems` is non-null, but `??` keeps TS happy inside the fallback branch.
- The manager link gate (`isActive || data.contest.isManager`) lets owners preview problems before start.

- [ ] **Step 6.3: Typecheck**

Run: `pnpm --filter @nojv/web check`
Expected: pass.

- [ ] **Step 6.4: Commit**

```bash
git add apps/web/src/routes/\(app\)/contests/\[slug\]/+page.svelte
git commit -m "feat(web): hide contest problems before start with placeholder"
```

---

## Task 7: Problem solve page — admit managers before `startsAt`

**Files:**
- Modify: `apps/web/src/routes/(app)/contests/[slug]/problems/[problemId]/+page.server.ts`

- [ ] **Step 7.1: Update the load function**

Replace the `load` body:

```ts
import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";
import { contestDomain, problemDomain, submissionDomain } from "@nojv/domain";

const { getContestWorkspaceData } = contestDomain;
const { getProblemPageData } = problemDomain;
const { listProblemSubmissions } = submissionDomain;
import { requireAuth } from "$lib/server/auth";

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  const { slug: contestSlug, problemId } = event.params;
  const now = new Date();

  const [contestData, problem, submissions] = await Promise.all([
    getContestWorkspaceData(contestSlug, actor.userId, { now }),
    getProblemPageData(problemId),
    listProblemSubmissions(actor.userId, problemId)
  ]);

  if (!contestData) {
    error(404, "Contest not found");
  }

  if (!problem) {
    error(404, "Problem not found");
  }

  // A manager may preview any problem in the contest even before start.
  // Non-managers still require the contest to be active.
  const problemsList = contestData.problems ?? [];
  const isContestProblem = problemsList.some((p) => p.id === problemId);

  if (!isContestProblem && !contestData.isManager) {
    error(404, "Problem not found in this contest");
  }

  if (!contestData.isManager) {
    if (now < new Date(contestData.startsAt)) {
      redirect(303, `/contests/${contestSlug}`);
    }
    if (now > new Date(contestData.endsAt)) {
      redirect(303, `/contests/${contestSlug}`);
    }
  }

  return {
    contestData,
    contestSlug,
    problem,
    submissions
  };
};
```

Key changes:
- Passes `{ now }` to `getContestWorkspaceData`.
- Uses `contestData.problems ?? []` (safe because managers bypass the hide).
- `isManager` short-circuits both the `isContestProblem` check (manager might be previewing a hidden list — but because managers bypass hide, `problems` is populated, so the check still works; the `!contestData.isManager` guard is a defensive safety net for any future logic change) and the time gates.

- [ ] **Step 7.2: Typecheck**

Run: `pnpm --filter @nojv/web check`
Expected: pass.

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/src/routes/\(app\)/contests/\[slug\]/problems/\[problemId\]/+page.server.ts
git commit -m "feat(web): admit contest managers before startsAt"
```

---

## Task 8: Additive repo methods for the list page

**Files:**
- Modify: `packages/db/src/repositories/contest.ts`

- [ ] **Step 8.1: Add two new methods to `contestRepo`**

In `packages/db/src/repositories/contest.ts`, add (do not modify existing methods):

```ts
listManagedForUser(userId: string, managedCourseIds: string[]) {
  return prisma.contest.findMany({
    where: {
      OR: [
        { createdByUserId: userId },
        ...(managedCourseIds.length > 0
          ? [{ courseId: { in: managedCourseIds } }]
          : [])
      ]
    },
    include: {
      _count: { select: { participations: true, problems: true } },
      course: { select: { slug: true, title: true } }
    },
    orderBy: { updatedAt: "desc" }
  });
},

listParticipableForUser(studentCourseIds: string[]) {
  return prisma.contest.findMany({
    where: {
      visibility: "published",
      OR: [
        { courseId: null },
        ...(studentCourseIds.length > 0
          ? [{ courseId: { in: studentCourseIds } }]
          : [])
      ]
    },
    include: {
      _count: { select: { participations: true, problems: true } },
      course: { select: { slug: true, title: true } }
    },
    orderBy: { startsAt: "desc" }
  });
},
```

- [ ] **Step 8.2: Typecheck**

Run: `pnpm --filter @nojv/db exec tsc --noEmit`
Expected: pass.

- [ ] **Step 8.3: Commit**

```bash
git add packages/db/src/repositories/contest.ts
git commit -m "feat(db): add listManagedForUser and listParticipableForUser"
```

---

## Task 9: Domain — `listContestsForUser`

**Files:**
- Modify: `packages/domain/src/contest/queries.ts`
- Test: `tests/integration/domain/contest-list-for-user.test.ts`

- [ ] **Step 9.1: Write the failing integration test**

Create `tests/integration/domain/contest-list-for-user.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  createTestContest,
  createTestUser,
  testPrisma
} from "../../fixtures/factories";

import { contestDomain } from "@nojv/domain";

const { listContestsForUser } = contestDomain;

async function createCourseWithMember(
  role: "teacher" | "ta" | "student",
  userId: string,
  slug: string
) {
  const course = await testPrisma.course.create({
    data: {
      id: slug,
      slug,
      title: `Course ${slug}`,
      description: "",
      locale: "en",
      visibility: "listed",
      ownerId: userId
    }
  });
  await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId, role, status: "active" }
  });
  return course;
}

describe("listContestsForUser", () => {
  it("puts user-created standalone contests into managed, not participable", async () => {
    const user = await createTestUser();
    const mine = await createTestContest({
      createdByUserId: user.id,
      visibility: "published",
      title: "Mine"
    });
    await createTestContest({
      visibility: "published",
      title: "Public"
    });

    const result = await listContestsForUser(user.id, new Date());

    const managedIds = result.managed.map((c) => c.id);
    const participableIds = result.participable.map((c) => c.id);
    expect(managedIds).toContain(mine.id);
    expect(participableIds).not.toContain(mine.id);
    expect(participableIds.map((id) => id)).toHaveLength(1);
  });

  it("includes draft contests in managed for the owner", async () => {
    const user = await createTestUser();
    const draft = await createTestContest({
      createdByUserId: user.id,
      visibility: "draft",
      title: "Draft"
    });

    const result = await listContestsForUser(user.id, new Date());
    expect(result.managed.map((c) => c.id)).toContain(draft.id);
  });

  it("puts course-teacher contests into managed", async () => {
    const teacher = await createTestUser();
    const course = await createCourseWithMember("teacher", teacher.id, "course-t1");
    const contest = await createTestContest({
      visibility: "published",
      courseId: course.id
    });

    const result = await listContestsForUser(teacher.id, new Date());
    expect(result.managed.map((c) => c.id)).toContain(contest.id);
    expect(result.participable.map((c) => c.id)).not.toContain(contest.id);
  });

  it("puts course-TA contests into managed", async () => {
    const ta = await createTestUser();
    const course = await createCourseWithMember("ta", ta.id, "course-ta1");
    const contest = await createTestContest({
      visibility: "published",
      courseId: course.id
    });

    const result = await listContestsForUser(ta.id, new Date());
    expect(result.managed.map((c) => c.id)).toContain(contest.id);
  });

  it("puts course-student contests into participable", async () => {
    const student = await createTestUser();
    const course = await createCourseWithMember("student", student.id, "course-s1");
    const contest = await createTestContest({
      visibility: "published",
      courseId: course.id
    });

    const result = await listContestsForUser(student.id, new Date());
    expect(result.participable.map((c) => c.id)).toContain(contest.id);
    expect(result.managed.map((c) => c.id)).not.toContain(contest.id);
  });

  it("does not duplicate a contest that the user both created and teaches", async () => {
    const user = await createTestUser();
    const course = await createCourseWithMember("teacher", user.id, "course-dup");
    const contest = await createTestContest({
      createdByUserId: user.id,
      visibility: "published",
      courseId: course.id
    });

    const result = await listContestsForUser(user.id, new Date());
    const managedAppearances = result.managed.filter((c) => c.id === contest.id).length;
    expect(managedAppearances).toBe(1);
    expect(result.participable.map((c) => c.id)).not.toContain(contest.id);
  });

  it("returns only public standalone contests for unauthenticated callers", async () => {
    const owner = await createTestUser();
    const course = await createCourseWithMember("teacher", owner.id, "course-anon");
    const standalone = await createTestContest({ visibility: "published" });
    await createTestContest({ visibility: "published", courseId: course.id });

    const result = await listContestsForUser(null, new Date());
    expect(result.managed).toEqual([]);
    expect(result.participable.map((c) => c.id)).toContain(standalone.id);
  });
});
```

- [ ] **Step 9.2: Run the test to verify it fails**

Run: `pnpm test:integration tests/integration/domain/contest-list-for-user.test.ts`
Expected: FAIL — `listContestsForUser` not exported.

- [ ] **Step 9.3: Implement `listContestsForUser`**

Add to `packages/domain/src/contest/queries.ts`:

```ts
export interface ContestListItemForUser extends ContestListItem {
  visibility: "draft" | "published" | "archived";
}

export type ContestListForUserResult = {
  participable: ContestListItem[];
  managed: ContestListItemForUser[];
};

export async function listContestsForUser(
  userId: string | null,
  _now: Date
): Promise<ContestListForUserResult> {
  if (userId === null) {
    const rows = await contestRepo.listParticipableForUser([]);
    return { managed: [], participable: rows.map(mapContestListItem) };
  }

  const memberships = await courseMembershipRepo.listActiveForUser(userId);
  const teacherOrTaCourseIds = memberships
    .filter((m) => m.role === "teacher" || m.role === "ta")
    .map((m) => m.courseId);
  const studentCourseIds = memberships
    .filter((m) => m.role === "student")
    .map((m) => m.courseId);

  const [managedRows, participableRows] = await Promise.all([
    contestRepo.listManagedForUser(userId, teacherOrTaCourseIds),
    contestRepo.listParticipableForUser(studentCourseIds)
  ]);

  const managedIds = new Set(managedRows.map((c) => c.id));
  const participable = participableRows
    .filter((c) => !managedIds.has(c.id))
    .map(mapContestListItem);

  const managed = managedRows.map((row) => ({
    ...mapContestListItem(row),
    visibility: row.visibility
  }));

  return { managed, participable };
}
```

Notes:
- `mapContestListItem` is the existing helper used by `listPublicContests`; reuse it. If its output type lacks `visibility`, extend it or construct the managed rows inline — whatever matches the current helper.
- `_now` is reserved for future use (e.g., filtering out very old archived contests); for now the parameter is in the signature so callers pass it.

- [ ] **Step 9.4: Run the test to verify it passes**

Run: `pnpm test:integration tests/integration/domain/contest-list-for-user.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 9.5: Commit**

```bash
git add packages/domain/src/contest/queries.ts \
        tests/integration/domain/contest-list-for-user.test.ts
git commit -m "feat(domain): add listContestsForUser with managed/participable split"
```

---

## Task 10: List page `+page.server.ts` — call `listContestsForUser`

**Files:**
- Modify: `apps/web/src/routes/(app)/contests/+page.server.ts`

- [ ] **Step 10.1: Update the load function**

Replace the `load` function (keep `actions` unchanged):

```ts
export const load: PageServerLoad = async (event) => {
  const actor = getActorContext(event);
  const now = new Date();
  const { managed, participable } = await contestDomain.listContestsForUser(
    actor?.userId ?? null,
    now
  );
  return { managed, participable, loggedIn: actor != null };
};
```

And adjust the top-level destructure:

```ts
const { findContestByInviteCode, listContestsForUser } = contestDomain;
```

…or drop the destructure for `listContestsForUser` and call `contestDomain.listContestsForUser(...)` inline — pick whichever matches the rest of the file's style.

- [ ] **Step 10.2: Typecheck**

Run: `pnpm --filter @nojv/web check`
Expected: pass, though `+page.svelte` will still reference the old `contests` prop — that's fixed in Task 11.

- [ ] **Step 10.3: Commit**

```bash
git add apps/web/src/routes/\(app\)/contests/+page.server.ts
git commit -m "feat(web): load participable and managed contests on list page"
```

---

## Task 11: List page `+page.svelte` — Tabs + empty states + badges

**Files:**
- Modify: `apps/web/src/routes/(app)/contests/+page.svelte`

- [ ] **Step 11.1: Replace the contest list rendering with Tabs**

In the `<script>` block, add imports and tab state:

```ts
import * as Tabs from "$lib/components/ui/tabs/index.js";
import { page } from "$app/stores";
import { goto } from "$app/navigation";

let { data } = $props();

let tabValue = $state<"participable" | "managed">(
  ($page.url.searchParams.get("tab") === "managed" ? "managed" : "participable")
);

function onTabChange(value: string) {
  tabValue = value as "participable" | "managed";
  const url = new URL($page.url);
  if (value === "managed") url.searchParams.set("tab", "managed");
  else url.searchParams.delete("tab");
  goto(url, { replaceState: true, keepFocus: true, noScroll: true });
}
```

Wrap the existing grid in `<Tabs.Root>`:

```svelte
<Tabs.Root value={tabValue} onValueChange={onTabChange}>
  <Tabs.List>
    <Tabs.Trigger value="participable">{m.contests_tabParticipable()}</Tabs.Trigger>
    <Tabs.Trigger value="managed">{m.contests_tabManaged()}</Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="participable">
    {#if data.participable.length === 0}
      <p class="text-body text-muted-foreground">{m.contests_emptyParticipable()}</p>
    {:else}
      <!-- existing card grid, iterating data.participable instead of data.contests -->
    {/if}
  </Tabs.Content>

  <Tabs.Content value="managed">
    {#if data.managed.length === 0}
      <p class="text-body text-muted-foreground">{m.contests_emptyManaged()}</p>
    {:else}
      <!-- same card grid, iterating data.managed, with visibility badge -->
    {/if}
  </Tabs.Content>
</Tabs.Root>
```

- [ ] **Step 11.2: Extract the card into a snippet and add visibility badge for managed**

Inside the `<script>`, define a Svelte 5 snippet that renders a single card. The snippet takes `(contest, showVisibility)`:

```svelte
{#snippet contestCard(contest, showVisibility)}
  <!-- Existing card markup from the current file, preserved verbatim, except: -->
  <!-- when showVisibility && contest.visibility !== 'published', render a small badge -->
  {#if showVisibility && contest.visibility === "draft"}
    <span class="rounded-sm bg-muted px-2 py-0.5 text-caption text-muted-foreground">
      {m.contests_visibilityDraft()}
    </span>
  {:else if showVisibility && contest.visibility === "archived"}
    <span class="rounded-sm bg-muted px-2 py-0.5 text-caption text-muted-foreground">
      {m.contests_visibilityArchived()}
    </span>
  {/if}
{/snippet}
```

Then inside each `Tabs.Content`, call the snippet:

```svelte
{#each data.participable as contest (contest.id)}
  {@render contestCard(contest, false)}
{/each}
```

```svelte
{#each data.managed as contest (contest.id)}
  {@render contestCard(contest, true)}
{/each}
```

(The snippet body is the current card markup — do not rewrite it from scratch; copy it wholesale from the existing `+page.svelte` so visual behavior is preserved.)

- [ ] **Step 11.3: Typecheck and boot**

Run: `pnpm --filter @nojv/web check`
Expected: pass.

Run: `pnpm --filter @nojv/web dev`
Manually: visit `/contests`, switch tabs, verify `?tab=managed` appears in URL, refresh and confirm tab persists.

- [ ] **Step 11.4: Commit**

```bash
git add apps/web/src/routes/\(app\)/contests/+page.svelte
git commit -m "feat(web): add participable/managed tabs to contest list"
```

---

## Task 12: E2E test — student sees placeholder, teacher sees problems

**Files:**
- Create: `tests/e2e/contest-hidden-problems.test.ts`

- [ ] **Step 12.1: Write the E2E test**

```ts
import { expect, test } from "@playwright/test";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");
const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

// The seed must create a contest whose startsAt is in the far future for this to pass.
// Reuse an existing seeded upcoming contest slug or add one to tests/fixtures/seed.
const UPCOMING_SLUG = "upcoming-demo-contest";

test.describe("Contest problem visibility", () => {
  test("student sees placeholder and no problem titles before start", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/contests/${UPCOMING_SLUG}`);

    await expect(page.getByText("Problems are not yet available")).toBeVisible();
    await expect(
      page.getByText("Problems will be revealed when the contest starts.")
    ).toBeVisible();
    // Seeded problem title that would leak if hiding is broken
    await expect(page.getByText("Two Sum")).toHaveCount(0);

    await context.close();
  });

  test("teacher of the course sees problem titles before start", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/contests/${UPCOMING_SLUG}`);

    await expect(page.getByText("Problems are not yet available")).toHaveCount(0);
    await expect(page.getByText("Two Sum")).toBeVisible();

    await context.close();
  });

  test("contest list has participable and managed tabs", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/contests");

    await expect(page.getByRole("tab", { name: "Participable" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "My contests" })).toBeVisible();

    await page.getByRole("tab", { name: "My contests" }).click();
    await expect(page).toHaveURL(/tab=managed/);

    await context.close();
  });
});
```

- [ ] **Step 12.2: Ensure seed has upcoming contest with a course teacher**

Check `tests/fixtures/seed` (or wherever the Playwright seed lives) — if no upcoming contest exists with `courseId` set and a seeded teacher in the auth state, add one. If a suitable contest already exists, update `UPCOMING_SLUG` and the title assertion (`"Two Sum"`) to match.

If adding a seed row is non-trivial, skip this task's teacher scenario and cover it with a broader integration test; note it in a follow-up.

- [ ] **Step 12.3: Run E2E**

Run: `pnpm test:e2e tests/e2e/contest-hidden-problems.test.ts`
Expected: PASS.

- [ ] **Step 12.4: Commit**

```bash
git add tests/e2e/contest-hidden-problems.test.ts tests/fixtures/
git commit -m "test(e2e): verify contest problem hiding and tabs"
```

---

## Task 13: Full verification

- [ ] **Step 13.1: Format**

Run: `pnpm format:write`
Then: `pnpm format`
Expected: no diff remaining.

- [ ] **Step 13.2: Lint**

Run: `pnpm lint`
Expected: pass.

- [ ] **Step 13.3: Unit tests**

Run: `pnpm test:unit`
Expected: pass.

- [ ] **Step 13.4: Integration tests**

Run: `pnpm test:integration`
Expected: pass.

- [ ] **Step 13.5: Typecheck web app**

Run: `pnpm --filter @nojv/web check`
Expected: pass.

- [ ] **Step 13.6: Manual smoke in the dev server**

Run: `pnpm --filter @nojv/web dev`

Walk through:
1. Anonymous → `/contests` → participable tab shows public contests; managed empty state visible.
2. Login as student → upcoming contest detail → placeholder visible, no problem titles in DOM. List page managed tab empty.
3. Login as course teacher → same upcoming contest → problem list visible, can click into a problem page even before start. List page managed tab contains the contest with no visibility badge (because it's `published`).
4. Login as course teacher → draft contest → visible in managed tab with `Draft` badge.
5. Switch `?tab=managed` / `?tab=participable` in the URL bar — page respects it.

Stop the dev server.

- [ ] **Step 13.7: Commit any formatting-only changes**

```bash
git status
# If format:write produced changes:
git add -A
git commit -m "chore: apply prettier formatting"
```

---

## Self-Review Notes

- **Spec coverage:** Every section of the spec maps to a task:
  - §1 permission primitive → Task 1
  - §2 detail page domain → Task 3
  - §3 problem solve page admit → Task 7
  - §4 placeholder UI → Task 6
  - §5 list page tabs → Tasks 8, 9, 10, 11
  - §6 i18n → Task 5
  - Testing §7 → Tasks 1.1, 3.1, 9.1, 12
- **Ambiguity fix over spec:** the spec says "repo untouched" but cleanly implementing `listContestsForUser` requires two new repo methods. The plan adds them as *additive* (no existing method signatures change). Existing `findDetailBySlug` / `findWorkspaceBySlug` remain byte-for-byte identical — the spirit of "don't break what's there" is preserved.
- **Task 11.2 snippet body is not inlined** because the existing card markup is ~40 lines of layout that must be copied verbatim from the current file. The step instructs the engineer to copy rather than reinvent; inlining here would hard-code markup that could drift from reality between spec-writing and execution.
- **Task 12.2 has a conditional escape hatch** for the E2E seed — if adding a dedicated upcoming-contest seed is too much churn, the test degrades gracefully.
- **`_now` parameter in `listContestsForUser`** is intentionally unused today but kept in the signature so callers pass a request-scoped clock. This matches `getContestDetail`'s shape and lets future filters (e.g., "hide contests that ended more than 90 days ago") drop in without a signature change.

