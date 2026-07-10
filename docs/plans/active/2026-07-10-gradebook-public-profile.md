# Course Gradebook + Public User Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (1) Course-level gradebook page: per-problem raw scores for every student across all non-draft assignments and exams, with CSV export; students see only their own row. (2) Public user profile page at `/users/[id]`, private by default, world-visible when the user opts in.

**Architecture:** Gradebook is a pure aggregation in `@nojv/application` over existing `Submission` + `ScoreOverride` data (zero migrations), rendered under the course tab bar with the existing client-side CSV pattern. Profile adds one `User.profilePublic` boolean, a public route group page reusing dashboard queries filtered to public problems, and a settings toggle.

**Tech Stack:** SvelteKit, Prisma 7, Zod 4, Paraglide i18n, Vitest, Playwright.

---

## Design decisions (validated with user)

- Gradebook granularity: **one column per problem**, grouped by context (assignment/exam), three header rows: context title → problem ordinal → per-problem max score. Last column = student raw total (header shows overall max).
- **Raw scores only** — no weights, no normalization. Teachers compute ratios themselves from the CSV.
- Contexts included: all non-draft assessments + exams of the course, ordered by open/start time.
- Cell value: best submission score per student per problem within the context, with `ScoreOverride` applied (same as existing matrices).
- Students see their own row (same page, reduced view). Staff (isManager) see all rows + CSV export.
- Profile: default **private** (`profilePublic=false`). Public = viewable without login. Private = only self + admin (effective role, respects admin mode); others get **404** (don't leak existence).
- Profile content: avatar, name, username, joined date, activity heatmap, difficulty/language distributions, solved **public published** problems list only.

## Feature A: Course Gradebook

### Task A1: application query `buildCourseGradebook`

**Files:**
- Create: `packages/application/src/course/gradebook.ts`
- Modify: `packages/application/src/course/index.ts` (add `export * from "./gradebook"`)
- Test: `tests/unit/domain/course-gradebook.test.ts`

**Step 1: Write failing unit test** following the `vi.hoisted` + `vi.mock("@nojv/db")` template in `tests/unit/domain/exam-submissions-matrix.test.ts`. Cover:
- columns grouped by context in chronological order, per-problem max from `getProblemTotalScores` (fallback to link points)
- best score per cell from `submissionRepo.groupByUserAndProblem`
- override replaces best score (`getOverridesForContext` per context, contextType assignment vs exam)
- student with no submissions → empty cells, total 0
- draft contexts excluded (repos called with `includeDrafts=false`)
- `forUserId` option returns only that student's row (student view)

**Step 2:** `pnpm vitest run tests/unit/domain/course-gradebook.test.ts` → FAIL (module not found).

**Step 3: Implement.** Shape:

```ts
export type GradebookColumn = {
  contextType: "assignment" | "exam";
  contextId: string;
  contextTitle: string;
  problems: { problemId: string; ordinal: number; maxScore: number }[];
  maxTotal: number;
};
export type GradebookRow = {
  userId: string; name: string; username: string | null;
  cells: Record<string, number | null>; // key `${contextType}:${contextId}:${problemId}`
  total: number;
};
export type CourseGradebook = { columns: GradebookColumn[]; rows: GradebookRow[]; maxTotal: number };

export async function buildCourseGradebook(courseId: string, options?: { forUserId?: string }): Promise<CourseGradebook>
```

Data flow: `assessmentRepo.listForCourse(courseId, false)` + `examRepo.listForCourse(courseId, false)` (with problem links) → sort by opensAt/startsAt → active student memberships via `courseMembershipRepo` → per context: `submissionRepo.groupByUserAndProblem({ assessmentId|examId, userId in students, sampleOnly:false })` + `getOverridesForContext({type, id})` → merge. Max scores via `getProblemTotalScores(problemIds)` (see `packages/application/src/problem/total-score.ts`), fallback link `points`. All DB access through repos only.

**Step 4:** test passes. **Step 5:** commit `feat(application): course gradebook aggregation query`.

### Task A2: grades route (server)

**Files:**
- Create: `apps/web/src/routes/(app)/courses/[courseId]/grades/+page.server.ts`

Follow `analytics/+page.server.ts` template: `handleLoad`, `requireAuth`, `const { course, isManager } = await event.parent()`. Staff → `buildCourseGradebook(courseId)`; student → `buildCourseGradebook(courseId, { forUserId: actor.userId })`. Both roles allowed (members only — layout already forbids non-members). Return `{ gradebook, isManager }`.

Unit test if a load-test convention fits; otherwise covered by e2e (A5). Commit.

### Task A3: grades page UI + tab

**Files:**
- Create: `apps/web/src/routes/(app)/courses/[courseId]/grades/+page.svelte`
- Modify: `apps/web/src/lib/components/features/course/CourseTabBar.svelte` (add `grades` to `CourseTabKey` + `tabs`, visible to all members)
- Modify: `apps/web/src/routes/(app)/courses/[courseId]/+layout.svelte` (`deriveActiveTab` switch)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/zh-TW.json` (`courseGradebook_*` keys, both files, flat, alphabetized)

Table: three header rows (context title with `colspan`, problem ordinal, max score), sticky first column, `overflow-x-auto` wrapper, last column total (header `total / maxTotal`). Student view renders the same table with the single row. Match Tailwind tokens per `docs/architecture/DESIGN.md`. Run `pnpm --filter @nojv/web paraglide:compile` after adding messages. Verify with `pnpm --filter @nojv/web check`. Commit.

### Task A4: CSV export (staff only)

**Files:**
- Modify: `apps/web/src/routes/(app)/courses/[courseId]/grades/+page.svelte`

Client-side export copying `exportCsv()`/`csvEscape` from `apps/web/src/lib/components/features/course/submissions/MatrixView.svelte`. CSV mirrors the table: row1 context titles, row2 problem ordinals, row3 max scores, then one row per student (name, username, cells, total). Filename `course-{courseId}-grades.csv`. Extract the escape helper to `$lib/utils/csv.ts` and reuse it in MatrixView only if trivial; otherwise duplicate the 3-line helper (surgical-change rule). Commit.

### Task A5: e2e test

**Files:**
- Create: `tests/e2e/course-grades.test.ts`

Using `tests/e2e/_shared.ts` fixtures: teacher sees full table + export button; student sees own row only, no export button. Run locally (`pnpm test:e2e -- course-grades`). Commit.

## Feature B: Public Profile

### Task B1: schema + migration

**Files:**
- Modify: `packages/db/prisma/schema/auth.prisma` (User: `profilePublic Boolean @default(false)`)
- Create: `packages/db/prisma/migrations/20260712000000_user_profile_public/migration.sql`:
  `ALTER TABLE "User" ADD COLUMN "profilePublic" BOOLEAN NOT NULL DEFAULT false;`

Run `pnpm db:push` (dev DB — never `migrate dev`), `pnpm db:generate`. Check migration drift gate conventions (see `20260703000000_super_admin_flag` as template). Commit.

### Task B2: application profile query + visibility

**Files:**
- Create: `packages/application/src/user/profile.ts`
- Modify: `packages/application/src/user/index.ts`
- Modify (if needed): `packages/db/src/repositories/submission.ts` — add public-problem-filtered variant of `findDistinctAcByUser` (`problem: { visibility: "public", status: "published" }`)
- Test: `tests/unit/domain/user-profile.test.ts`

TDD:
- `canViewProfile(viewer: {userId, effectiveRole} | null, target: {id, profilePublic})`: public → true; else self or admin → true; else false.
- `getPublicProfile(userId)`: user basics (name, username, image, createdAt, profilePublic) + solved public problems (id, title, difficulty, tags) + activity events (`getSubmissionActivity`) + language distribution (`groupByLanguageForUser`) + difficulty distribution derived from the **public-filtered** AC set (no private-problem leakage). Throw `NotFoundError` for missing user.

Commit.

### Task B3: public route `/users/[id]`

**Files:**
- Create: `apps/web/src/routes/(public)/users/[id]/+page.server.ts`
- Create: `apps/web/src/routes/(public)/users/[id]/+page.svelte`
- Modify: messages en/zh-TW (`userProfile_*` keys)

Load: viewer = `locals.sessionUser` (nullable in public group); admin check must use effective role (`resolveEffectivePlatformRole` with `locals.adminModeActive` — stored role alone bypasses admin-mode toggle, see permissions feedback). `canViewProfile` false or user missing → `NotFoundError` (404, both cases identical). UI: avatar `/api/storage/avatars/{id}` with `user.image` fallback, name/username/joined date, `ActivityHeatmap` (reuse `buildActivityModel` from `$lib/utils/activity.ts`), difficulty + language cards via `EChart` (copy option builders from `dashboard/+page.svelte`), solved problems list linking to `/problems/[id]`. Private-but-visible (self/admin viewing a private profile) shows a "not public" badge. `<title>` per root layout convention. Commit.

### Task B4: settings toggle

**Files:**
- Modify: `packages/application/src/user/mutations.ts` (add `updateProfileVisibility(userId, profilePublic)`)
- Modify: `apps/web/src/routes/(app)/settings/+page.server.ts` (action `?/updateProfileVisibility`, `withRateLimit` + `requireAuth`)
- Modify: `apps/web/src/routes/(app)/settings/+page.svelte` (new section with `ToggleSwitch`, superForm `dataType:"json"` pattern from `NotificationPreferencesDialog.svelte`; when public, show link to own `/users/[id]`)
- Test: extend `tests/unit/domain/user-profile.test.ts` for the mutation
- Modify: messages en/zh-TW

Commit.

### Task B5: e2e test

**Files:**
- Create: `tests/e2e/users-profile.test.ts`

Cases: logged-out visit to private profile → 404; owner enables toggle in settings; logged-out visit now renders name + heatmap; other logged-in student on private profile → 404; owner always sees own. Commit.

## Final verification

1. `pnpm --filter @nojv/web paraglide:compile && pnpm --filter @nojv/web check`
2. `pnpm lint && pnpm format`
3. `pnpm test:unit`
4. `pnpm test:integration` (schema touched)
5. e2e locally for the two new specs
6. Manual smoke via dev server (worktree recipe: build `packages/*`, copy `.env`, `--port 5174 --strictPort`)
7. Move this plan to `docs/plans/completed/` in the PR
