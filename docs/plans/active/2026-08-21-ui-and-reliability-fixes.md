# NOJV UI and Reliability Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refine the authenticated UI and fix submission/worker state handling so the requested copy, density, navigation, filtering, grading, editor, course-management, and failure states are consistent across public, student, teacher, and admin surfaces.

**Architecture:** Preserve the current SvelteKit → application → database/Temporal boundaries and existing design tokens/components. Consolidate repeated presentation changes in shared primitives or existing feature components; keep route loaders/actions responsible only for data and mutations. Fix submission lifecycle behavior at the shared service/route boundary so workspace, submission list, and navigation all consume the same durable state.

**Tech Stack:** SvelteKit, Svelte 5, Tailwind CSS 4, Bits UI, Paraglide i18n, Vitest, Playwright, Zod, Temporal.

---

## Scope and acceptance gates

- Work only in `/Users/takala/code/NOJV/.worktrees/ui-and-reliability-fixes` on `codex/ui-and-reliability-fixes`.
- No database migration is expected; use existing DTOs, repositories, and seeded records.
- Preserve Admin mode as a view of all data; normal student/teacher navigation remains scoped to the signed-in actor.
- “Workspace” means the problem-solving page/editor, not a generic workspace directory.
- Every user-visible string changed in the request must be represented in the message catalog and compiled with `pnpm --filter @nojv/web paraglide:compile`.
- Add focused regression tests for worker-unavailable failure, submission persistence/re-entry, pass-rate calculation, and destructive course deletion confirmation.
- Verify with `pnpm ci:verify`, focused integration/unit tests, and Playwright at `1920×1200` plus a narrow viewport for shared layouts.

## Task 1: Establish shared UI vocabulary and route ownership

**Files to inspect/modify:**

- `apps/web/src/routes/(app)/+layout.svelte`
- `apps/web/src/routes/(app)/admin/+layout.svelte`
- `apps/web/src/lib/components/primitives/ui/*`
- `apps/web/src/lib/components/features/course/*`
- `apps/web/src/lib/components/features/submission/*`
- `apps/web/messages/*.json`

1. Inventory existing cards, custom selects, status icons, tables, modal, spinner, and filter patterns.
2. Define the smallest shared patterns needed for state icons, right-aligned metadata, filter headers, score-cell colors, and loading indicators.
3. Update terminology (`競賽`, `排行榜`, `貢獻開源`, `Pull Request`, `為 NOJV 點個 Star`) in the catalog and remove redundant helper copy.
4. Compile Paraglide and add/adjust focused component tests where shared behavior changes.

## Task 2: Public/auth copy, dashboard density, and statistics

**Files:**

- `apps/web/src/routes/(public)/signin/+page.svelte` or the actual admin-signin route
- `apps/web/src/routes/(public)/+page.svelte`
- `apps/web/src/routes/(app)/dashboard/+page.svelte`
- `apps/web/src/routes/(app)/dashboard/+page.server.ts`
- chart/stat components and score aggregation in `packages/application/src/*`

1. Shorten the admin login explanation and make the Upcoming description fit one line at the target card width.
2. Rebalance overview cards so labels, values, and supporting content use the card height without empty voids or overlapping text.
3. Audit pass-rate aggregation against persisted verdict counts; fix the denominator/status mapping if wrong and reduce the center AC-rate label.
4. Make recent activity rows use the submission-tab visual vocabulary and link each row to `/submissions/[submissionId]`.
5. Make Admin overview use only useful populated cards, with recent submissions showing only SE and linking to the detail page.

## Task 3: Submission lifecycle, worker failure, and workspace persistence

**Files:**

- `apps/web/src/lib/services/submission-service.ts`
- `apps/web/src/routes/(app)/submissions/+page.svelte`
- `apps/web/src/routes/(app)/submissions/+page.server.ts`
- `apps/web/src/lib/components/features/problem/layouts/ProblemWorkspace.svelte`
- `apps/web/src/lib/components/features/problem/editors/*`
- `apps/web/src/routes/(app)/assignments/[assignmentId]/problems/[problemId]/+page.svelte`
- `apps/web/src/routes/(app)/exams/[examId]/problems/[problemId]/+page.svelte`
- `apps/web/src/routes/(app)/contests/[contestId]/problems/[problemId]/+page.svelte`
- Temporal dispatch adapter and relevant tests

1. Bound the submission dispatch/judge wait and return an actionable server error when the worker/Temporal path is unavailable; do not leave a request pending indefinitely.
2. Render a real spinner/loading state for queued submission replies; retain status text for screen readers.
3. Persist submitted workspace code and submission-history state across client navigation/tab changes using the existing durable source/draft mechanism, rehydrating from the server on entry.
4. Keep submission records linked from the workspace and context pages, and move “my submissions” to the bottom of assignment/exam pages.
5. Normalize case 1/case 2 tabs and remove misaligned close controls while preserving keyboard/focus behavior.
6. Add tests for worker unavailable, re-entry persistence, and queued loading state.

## Task 4: Submission, reports, users, and admin navigation

**Files:**

- `apps/web/src/routes/(app)/submissions/+page.svelte`
- `apps/web/src/routes/(app)/admin/+layout.svelte`
- `apps/web/src/routes/(app)/admin/+page.svelte`
- `apps/web/src/routes/(app)/admin/announcements/+page.svelte`
- `apps/web/src/routes/(app)/admin/reports/+page.svelte`
- `apps/web/src/routes/(app)/admin/users/+page.svelte`
- `apps/web/src/lib/components/features/admin/users/UsersTable.svelte`

1. Remove the Admin-only submission subtab and duplicate course/assignment/exam/contest subtabs; keep the top navigation routes and scope data by role.
2. Convert reports and users tables to the submissions-style filter header, aligned columns, and clickable rows.
3. Open a report detail modal on row click instead of rendering long reasons/details in the table.
4. Replace role/special-permission controls with border-bottom-only selects; show audit operation text and icons directly.
5. Remove the announcement count beside “新增公告”.
6. Keep Admin recent submissions as SE-only, clickable, and visually consistent.

## Task 5: Assessment/contest/course information architecture

**Files:**

- `apps/web/src/routes/(app)/assignments/+page.svelte`
- `apps/web/src/routes/(app)/exams/+page.svelte`
- `apps/web/src/routes/(app)/contests/+page.svelte`
- `apps/web/src/routes/(app)/assignments/[assignmentId]/+page.svelte`
- `apps/web/src/routes/(app)/exams/[examId]/+page.svelte`
- `apps/web/src/routes/(app)/contests/[contestId]/+page.svelte`
- `apps/web/src/routes/(app)/contests/[contestId]/scoreboard/+page.svelte`
- shared course/exam/assignment/contest row and card components

1. Remove count/status badges; place important counts on the right and use icons at the left for active/archived/live state.
2. Show course/assignment/exam context in the secondary line; contests show the organizer.
3. Fold the four metadata cards into the top hero card and move join/start actions into that card.
4. Remove requested redundant copy (`2題•比賽開始後解`, post-assessment scoring note, contest scoring-button noise) and rename scoreboard to 排行榜.
5. Make scoreboard show the exam-style ranking table, highlight the current user row, and render the score chart with time/problem-or-score axes.
6. In assessment/contest workspaces remove the top title/time strip, move time to the right of the description/submission tabs, preserve the original-page return link, and render subtask descriptions.

## Task 6: Course management, grades, and assessment creation flows

**Files:**

- `apps/web/src/routes/(app)/courses/new/+page.svelte`
- `apps/web/src/routes/(app)/courses/[courseId]/settings/+page.svelte`
- `apps/web/src/routes/(app)/courses/[courseId]/members/+page.svelte`
- `apps/web/src/routes/(app)/courses/[courseId]/analytics/+page.svelte`
- `apps/web/src/routes/(app)/courses/[courseId]/grades/+page.svelte`
- `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte`
- `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.svelte`
- `apps/web/src/lib/components/features/course/assignment/*`
- `apps/web/src/lib/components/features/course/exam/*`

1. Remove new-course helper/info copy, use a compact description hint, and remove step numbers.
2. Move archive/delete into the existing settings danger area without danger labels/icons; delete via a text-confirmation modal.
3. Remove “too small” client validation noise; require non-empty title only and add localized messages.
4. Merge basic information and problems into one card; remove empty-assignment helper copy; make ordering changes dirty the save button and prompt before leaving.
5. Move exam rules into the creation model, fold language/time/score into the top card, mark required labels with red `*`, and replace freeze timestamp with remaining-time input.
6. Add tooltips for opens/due/final times, localized validation, optional-attempts toggle, and a proper agreement button on exam entry.
7. Update members, analytics, and grades: filter header, aligned email/role columns, assignment+exam analysis, no student-count card, and sortable color-coded grade cells reused across assignments/exams/contests.
8. Add focused tests for delete confirmation, dirty ordering, grade color/sort behavior, and localized validation.

## Task 7: Problem authoring, content/docs, and API synchronization

**Files:**

- `apps/web/src/lib/components/features/problem/statement/SamplesEditor.svelte`
- `apps/web/src/lib/components/features/problem/testcase/*`
- `apps/web/src/routes/(public)/about/+page.svelte`
- `apps/web/src/routes/(public)/environment/+page.svelte`
- `apps/web/src/routes/(public)/legal/privacy/+page.svelte`
- `apps/web/src/routes/(public)/legal/terms/+page.svelte`
- `apps/web/src/routes/(public)/guides/advanced-mode/+page.svelte`
- `apps/web/src/routes/(public)/docs/+page.svelte`
- API OpenAPI sources and docs drift checks

1. Normalize sample/input/output border radii and concentric borders.
2. Update About copy and explain the TypeScript execution method accurately in Environment.
3. Review privacy/terms and advanced-mode guidance against current auth, submissions, data handling, and workspace behavior; update only factual drift.
4. Regenerate or update API docs from the current OpenAPI source and verify public/internal docs are synchronized.

## Final verification

1. Run `pnpm --filter @nojv/web paraglide:compile`.
2. Run focused unit/component/integration tests for changed behavior.
3. Run `pnpm ci:verify` and `git diff --check`.
4. Start the worktree web server on an unused port with worker intentionally stopped; verify the submission failure is fast and actionable, then start the normal dependency path.
5. Use Playwright at `1920×1200` and a narrow viewport to verify dashboard, admin reports/users, submissions, workspace, creation forms, course settings/grades, contest scoreboard, and key modals.
6. Run the Impeccable detector once over changed UI files and resolve unexplained findings.
7. Review exact diff and worktree status before handoff; leave `main` untouched.
