# CUID Unification & URL Restructure Design

Date: 2026-04-16
Status: Active — not yet in execution

## Problem

Current identifier story is inconsistent across the main domain models:

| Model | `id` | `slug` | URL uses |
|---|---|---|---|
| `Problem` | cuid | ❌ none | cuid in path |
| `Course` | cuid | ❌ none | cuid in path |
| `Exam` | cuid | ❌ none | cuid in path |
| `CourseAssessment` | cuid | ✅ `@@unique([courseId, slug])` | **dual** — route path uses `id`, cross-page context `?assessment=` uses `slug` |
| `Contest` | cuid | ✅ `@unique` | **dual** — `/contests/[slug]` path uses slug |

Two avoidable costs fall out of this:

1. **Collision risk** — `CourseAssessment` has two identifiers writing to the same URL surfaces (`findByCourseAndSlug` vs `findDetailById`). Any path that takes the wrong one silently 404s.
2. **Inconsistent solve URLs** — the three "solve a problem in context" flows use three totally different URL shapes:
   - Assignment: `/problems/[id]?course=X&assessment=Y`
   - Contest:   `/contests/[slug]/problems/[problemId]`
   - Exam:      `/courses/[courseId]/exams/[examId]/problems/[idx]`

   Each has its own gate, context resolution, and chrome. Adding contest-side proctoring (page lock, IP binding — planned) would triple the work.

## Goal

- **One identifier per model** — everything uses cuid. Slug columns and all slug-aware repo methods go away.
- **One URL shape for "solve a problem in context X"** — three sibling route families under `/assignments`, `/contests`, `/exams`, all ending in `problems/[problemId]`. Practice mode stays at `/problems/[problemId]`.
- **Gate at the layout layer** — each context root has a `+layout.server.ts` that enforces membership, time window, and (future) proctoring. Child routes inherit the gate; impossible to forget.
- **Make contest-side proctoring possible, not required** — wire the `+layout.server.ts` hook in contest so adding page lock / IP binding later is a small diff, not a refactor.

## Non-Goals

- Changing the cuid generator (stay with Prisma `@default(cuid())`; "uuid" in user shorthand = "one globally unique id per row").
- Adding contest proctoring in this plan — only the hook point is built.
- Preserving `[idx]` in exam routes — user chose symmetry (all routes end `problems/[problemId]`) over URL opaqueness. Prev/Next is computed from exam context's ordered problem list.

## Target State

### Schema

```diff
 model CourseAssessment {
   id       String @id @default(cuid())
   courseId String
-  slug     String
   title    String
   ...
-  @@unique([courseId, slug])
 }

 model Contest {
   id       String @id @default(cuid())
-  slug     String @unique
   title    String
   ...
 }
```

### URL map

| Scenario | Before | After |
|---|---|---|
| Standalone practice | `/problems/[id]` | `/problems/[problemId]` (renamed param only) |
| Assignment solve | `/problems/[id]?course=X&assessment=Y` | `/assignments/[assessmentId]/problems/[problemId]` |
| Contest solve | `/contests/[slug]/problems/[problemId]` | `/contests/[contestId]/problems/[problemId]` |
| Exam solve | `/courses/[courseId]/exams/[examId]/problems/[idx]` | `/exams/[examId]/problems/[problemId]` |
| Assignment detail (management + overview) | `/courses/[courseId]/assignments/[assignmentId]` | `/assignments/[assessmentId]` *(role-gated tabs)* |
| Exam detail (management + overview) | `/courses/[courseId]/exams/[examId]` | `/exams/[examId]` *(role-gated tabs)* |
| Contest overview | `/contests/[slug]` | `/contests/[contestId]` |
| Assignment list (per-course) | `/courses/[courseId]/assignments/` | unchanged |
| Exam list (per-course) | `/courses/[courseId]/exams/` | unchanged |
| Assignment create | `/courses/[courseId]/assignments/new` | unchanged |
| Exam create | `/courses/[courseId]/exams/new` | unchanged |

Rationale for the split: list + create pages stay under `/courses/[courseId]/...` because they need courseId from the URL (list is per-course, create needs a target course). **Detail + solve pages** promote to top-level because the entity's own cuid is globally unique and the detail page doesn't need the course shell's chrome — it wants its own layout (gate, context, proctoring).

### Route tree

```
apps/web/src/routes/(app)/
  problems/[problemId]/                ← practice (flow unchanged, param renamed)
    +page.server.ts
    +page.svelte                       (5-line shell → <ProblemSolveView />)

  assignments/[assessmentId]/          ← NEW top-level, replaces /courses/*/assignments/[id]
    +layout.server.ts                  gate: resolve courseId from row + membership + time window
    +layout.svelte                     assignment chrome
    +page.svelte                       detail (role-gated tabs: problems / submissions / plagiarism / edit)
    problems/[problemId]/
      +page.server.ts                  delegates to loadProblemSolveData(...)
      +page.svelte                     (5 lines)
    edit/                              (moved from /courses/.../assignments/[id]/edit)

  contests/[contestId]/                ← RENAMED from [slug]
    +layout.server.ts                  gate via shared proctoring helper (membership + window + page lock + IP)
    +layout.svelte                     contest chrome
    +page.svelte
    problems/[problemId]/
    scoreboard/

  exams/[examId]/                      ← NEW top-level, replaces /courses/*/exams/[id]
    +layout.server.ts                  gate via shared proctoring helper
    +layout.svelte                     exam chrome (countdown, sibling rail)
    +page.svelte                       detail (role-gated tabs: problems / session events / edit)
    problems/[problemId]/
      +page.server.ts                  prev/next from exam-context ordered problem list
      +page.svelte
    edit/                              (moved from /courses/.../exams/[id]/edit)

  courses/[courseId]/                  ← management shell
    +layout.server.ts                  (unchanged — loads course + membership)
    +page.svelte                       course overview
    roster/                            (unchanged)
    announcements/                     (unchanged)
    assignments/                       LIST only — row links → /assignments/[id]
      new/                             creation (needs courseId from URL)
    exams/                             LIST only — row links → /exams/[id]
      new/                             creation
    manage/
      plagiarism/[assessmentSlug]/     → move to /assignments/[assessmentId]/plagiarism (tab or sub-route)
```

Tabs inside `/assignments/[assessmentId]/+page.svelte` and `/exams/[examId]/+page.svelte` are role-gated by the loader: teachers see plagiarism + submissions matrix + edit link; students see only problems + their own submissions. The URL is the same; the render branches on `data.mode: "teacher" | "student"`.

### Shared render layer

`ProblemSolveView.svelte` already accepts `mode`, `assessment`, `contestSlug`, `siblingProblems`, `examContext`. It stays. Each route's `+page.svelte` is a thin wrapper:

```svelte
<script lang="ts">
  import ProblemSolveView from "$lib/components/problem/ProblemSolveView.svelte";
  let { data } = $props();
</script>
<ProblemSolveView {...data.solveProps} />
```

Shared loader helper `loadProblemSolveData(problemId, context)` lives in `$lib/server/problem-solve.ts`. Each `+page.server.ts` does context-specific resolution (assessment membership, contest enrollment, exam session), then hands problemId + resolved context to the helper. The helper returns a uniform `solveProps` shape.

Context prop reshape (after slug removal):

```ts
// before
assessment?: { assessmentSlug: string; courseId: string }
contestSlug?: string

// after
assessment?: { assessmentId: string; courseId: string }
contestId?: string
```

## Migration Plan

Phased because the DB migration is irreversible and the route rename is a breaking URL change.

### Phase 1 — repo + domain layer (no URL or DB change yet)

Add id-based lookup methods alongside the existing slug ones. Don't remove slug yet.

1. `packages/db/src/repositories/assessment.ts`
   - Add `findByCourseAndId(courseId, assessmentId)` (already exists as `findDetailById` for one path — generalize).
   - Add `findByIdForMembership(assessmentId)` if composite lookup by `(courseId, userId)` needs decoupling.
2. `packages/db/src/repositories/contest.ts`
   - Add `findById(contestId)` variant for every `findBySlug`.

Verify: all existing tests still pass. Zero behavior change.

### Phase 2 — rewire call sites

Convert every `findByCourseAndSlug` / `findByComposite(courseId, slug)` / `findBySlug(slug)` call to its id counterpart.

Files from grep:

- `packages/domain/src/course/mutations.ts` (assessment create uniqueness check — needs rethink, see §Uniqueness)
- `packages/domain/src/course/queries.ts`
- `packages/domain/src/submission/queries.ts`
- `packages/domain/src/submission/mutations.ts`
- `packages/domain/src/exam/mutations.ts`
- `packages/domain/src/exam/session.ts`
- `packages/domain/src/contest/queries.ts`
- `packages/domain/src/contest/scoring.ts`
- `packages/domain/src/contest/mutations.ts`
- `packages/domain/src/shared/require.ts`
- `packages/core/src/schemas/course.ts` — `assessmentSlug` → `assessmentId` on submission / draft schemas
- `packages/core/src/schemas/submission.ts`
- `packages/core/src/schemas/contest.ts`
- `apps/web/src/routes/api/submissions/+server.ts` — drop legacy `problemSlug` alias, rename `assessmentSlug` → `assessmentId`
- `apps/web/src/lib/services/submission-service.ts` — same
- All tests under `tests/unit/core/`, `tests/unit/domain/`, `tests/unit/web/`

Uniqueness: `@@unique([courseId, slug])` dropped, nothing added in its place (see Decisions §2).

### Phase 3 — proctoring helper extraction + contest schema

Before restructuring routes, factor the proctoring logic out of its current exam-only home into a shared module. Contest schema gains the mirror fields.

Schema additions (Contest):
```diff
 model Contest {
   id          String @id @default(cuid())
   title       String
   ...
+  // Proctoring (mirrors Exam — both entities share the shared helper)
+  pageLock         Boolean           @default(false)
+  ipBinding        Boolean           @default(false)
+  ipWhitelist      String[]          @default([])
+  ipWhitelistEnabled Boolean         @default(false)
+  ipViolationMode  String            @default("block")
 }
```

(Exact field list mirrors whatever `Exam` has today — treat Exam as the reference.)

Shared helper module:
- `packages/domain/src/proctoring/` — new folder
  - `gate.ts` — `checkProctoringGate({ entityKind: "exam"|"contest", entityId, userId, ip }): ProctoringVerdict` — consolidates membership + window + page-lock + IP-binding + IP-whitelist checks
  - `violation-logger.ts` — wraps `IpViolationLog` writes (already schema-ready for both contest + assessment FKs)
- Migrate `apps/web/src/hooks.server.ts`'s `isExamAllowed` / `getCachedPageLockContext` to call the shared helper
- `apps/web/src/lib/server/proctoring-gate.ts` — SvelteKit RequestEvent wrapper around the domain helper

Data migration (proctoring fields for Contest): add with safe defaults (no proctoring applied to existing contests until a teacher opts in).

### Phase 4 — route tree restructure

Add new route directories in parallel to old ones. Do NOT delete the old routes yet.

New:
- `apps/web/src/routes/(app)/assignments/[assessmentId]/` (+layout.server.ts, +layout.svelte, +page.svelte, problems/[problemId]/, edit/)
- `apps/web/src/routes/(app)/exams/[examId]/` (same children)
- `apps/web/src/routes/(app)/contests/[contestId]/` (replaces `[slug]` — see below)

For contest, rename `[slug]` → `[contestId]` in a single commit across all descendants (route + API namespaces `/api/contests/[slug]/*`).

All three layouts consume the shared proctoring helper built in Phase 3. Assignment is the lightest: membership + time window only (no page lock by default for homework). Contest and exam get the full proctoring gate when those fields are enabled on the row.

All link-generation sites (search `contests/\${`, `exams/\${`, `assignments/\${`, `/courses/\${.*}/assignments/\${`, `/courses/\${.*}/exams/\${`) get updated to point at the new top-level URLs.

Helper file: delete `assessmentPath(courseId, slug)` from `apps/web/src/lib/types.ts`; replace with `assignmentPath(assessmentId)` that returns `/assignments/${assessmentId}`, plus `contestPath(contestId)` and `examPath(examId)` counterparts.

### Phase 5 — delete the slug columns

```sql
-- packages/db/prisma/migrations/<timestamp>_drop_assessment_contest_slug/migration.sql
ALTER TABLE "CourseAssessment" DROP CONSTRAINT "CourseAssessment_courseId_slug_key";
ALTER TABLE "CourseAssessment" DROP COLUMN "slug";
ALTER TABLE "Contest" DROP CONSTRAINT "Contest_slug_key";
ALTER TABLE "Contest" DROP COLUMN "slug";
```

Regenerate Prisma client. All Phase 2 rewires should now compile against a schema where `slug` doesn't exist — if any missed, TypeScript catches them here.

### Phase 6 — delete old routes

Once Phase 4 is deployed and Phase 5 migration has run:
- Delete `/courses/[courseId]/assignments/[assignmentId]/` subtree (detail + edit + plagiarism sub-routes). Their URLs now live under `/assignments/[assessmentId]/`.
- Delete `/courses/[courseId]/exams/[examId]/` subtree (detail + edit). Their URLs now live under `/exams/[examId]/`.
- Rename `apps/web/src/routes/(app)/problems/[id]/` → `[problemId]/`. Drop the `course=X&assessment=Y` query-param branch from its server loader — assignment solves now have their own route family.

Keep `/courses/[courseId]/assignments/` (LIST), `new/` (create), `/courses/[courseId]/exams/` (LIST), `new/`, `/courses/[courseId]/manage/*` — except `manage/plagiarism/[assessmentSlug]` which moves as a tab under `/assignments/[assessmentId]/`.

### Phase 7 — seed sanity

Per Decisions §1, seeds keep readable ids as literal cuids (no change). Only action in this phase is verifying the seeds still load cleanly after the schema changes in Phase 5 and that dev URLs still work with the readable ids.

## Breaking Changes

- All existing bookmarks / deep links to `/courses/*/exams/*` or `/contests/<slug>` are gone. Internal tool, ~5 external users max, acceptable.
- Any TA tooling or copy-paste workflow that relied on readable assessment slugs breaks. Document in release notes.
- Submission API payload field rename: `assessmentSlug` → `assessmentId`. Add a one-release compatibility shim in `apps/web/src/routes/api/submissions/+server.ts` (accept both, prefer new), then remove it after a grace period.

## Risks

| Risk | Mitigation |
|---|---|
| Phase 5 migration runs before Phase 2 finishes (schema column gone while code still references it) | Gate Phase 5 on `pnpm -w typecheck` clean AND all Phase 2 PRs merged. |
| Route rename leaks an old link in markdown statement / email template | Grep before Phase 4 lands. List of known link-gen sites comes from Phase 2 grep. |
| Contest `[slug]` → `[contestId]` touches API routes too; downstream scoreboard polling / websocket clients might cache old URLs in browser memory | Force page reload via `version.name` bump in `svelte.config.js` with the Phase 4 deploy. |
| Contest proctoring fields added with safe defaults but an existing contest's zod schema expects legacy shape | Regenerate zod via Prisma → zod or manually mirror; add unit test on contest schema before Phase 3 lands. |
| Shared proctoring helper regresses exam behavior when exam path was the prior working reference | Keep the extraction diff surgical: move — don't rewrite. Run all existing exam integration tests after Phase 3. |

## File-level Checklist (Execution Plan)

### DB
- [ ] `packages/db/prisma/schema/course.prisma` — remove `slug`, `@@unique([courseId, slug])`
- [ ] `packages/db/prisma/schema/contest.prisma` — (a) remove `slug @unique` (b) add proctoring fields mirroring `Exam`: `pageLock`, `ipBinding`, `ipWhitelist`, `ipWhitelistEnabled`, `ipViolationMode`
- [ ] New migration `<ts>_drop_assessment_contest_slug/migration.sql`
- [ ] New migration `<ts>_add_contest_proctoring/migration.sql`
- [ ] `packages/db/src/repositories/assessment.ts` — remove `findByCourseAndSlug`, `findByComposite(courseId, slug)`. Keep id-based.
- [ ] `packages/db/src/repositories/contest.ts` — remove `findBySlug`. Keep `findById`.
- [ ] `packages/db/src/repositories/course.ts` — audit any slug-awareness (per grep result)
- [ ] Seeds — no id changes (per Decisions §1). Verify loads cleanly after proctoring + slug drop.

### Core schemas
- [ ] `packages/core/src/schemas/course.ts` — rename `assessmentSlug` → `assessmentId`
- [ ] `packages/core/src/schemas/submission.ts` — same
- [ ] `packages/core/src/schemas/contest.ts` — drop slug field if present

### Domain
- [ ] `packages/domain/src/course/mutations.ts` — drop slug uniqueness check (nothing replaces it per Decisions §2)
- [ ] `packages/domain/src/course/queries.ts`
- [ ] `packages/domain/src/submission/queries.ts`
- [ ] `packages/domain/src/submission/mutations.ts`
- [ ] `packages/domain/src/exam/mutations.ts`
- [ ] `packages/domain/src/exam/session.ts`
- [ ] `packages/domain/src/contest/queries.ts`
- [ ] `packages/domain/src/contest/mutations.ts`
- [ ] `packages/domain/src/contest/scoring.ts`
- [ ] `packages/domain/src/shared/require.ts`

### Proctoring helper (new module)
- [ ] `packages/domain/src/proctoring/gate.ts` — `checkProctoringGate({ entityKind, entityId, userId, ip })` returning `ProctoringVerdict`. Consolidates logic currently in exam session + hooks.
- [ ] `packages/domain/src/proctoring/violation-logger.ts` — `IpViolationLog` writer shared across contest + assessment FKs
- [ ] `packages/domain/src/proctoring/index.ts` — barrel export
- [ ] `apps/web/src/lib/server/proctoring-gate.ts` — SvelteKit RequestEvent wrapper calling `checkProctoringGate`
- [ ] `apps/web/src/hooks.server.ts` — migrate `isExamAllowed` / `getCachedPageLockContext` to the shared helper; teach it contest awareness

### Web — routes (new)
- [ ] `apps/web/src/routes/(app)/assignments/[assessmentId]/+layout.server.ts` — resolves assessment, courseId, membership; calls proctoring helper (light mode — membership + window only for assignments)
- [ ] `apps/web/src/routes/(app)/assignments/[assessmentId]/+layout.svelte` — assignment chrome
- [ ] `apps/web/src/routes/(app)/assignments/[assessmentId]/+page.svelte` — detail with role-gated tabs (problems / submissions / plagiarism / edit link)
- [ ] `apps/web/src/routes/(app)/assignments/[assessmentId]/problems/[problemId]/+page.server.ts` + `.svelte`
- [ ] `apps/web/src/routes/(app)/assignments/[assessmentId]/edit/+page.server.ts` + `.svelte` — move from `/courses/.../assignments/[id]/edit`
- [ ] `apps/web/src/routes/(app)/assignments/[assessmentId]/plagiarism/+page.server.ts` + `.svelte` — move from `/courses/.../manage/plagiarism/[assessmentSlug]`
- [ ] `apps/web/src/routes/(app)/exams/[examId]/` — same five file skeleton (layout gate + chrome + detail + problems subroute + edit). Layout calls proctoring helper in full mode.
- [ ] `apps/web/src/routes/(app)/contests/[contestId]/` — rename + expand the existing `[slug]/` tree. Layout calls proctoring helper in full mode.
- [ ] Rename `apps/web/src/routes/api/contests/[slug]/` → `[contestId]/` (scoreboard, freeze endpoints)
- [ ] Rename `apps/web/src/routes/(app)/problems/[id]/` → `[problemId]/`; drop `course`/`assessment` query-param branch

### Web — routes (delete in Phase 6)
- [ ] `apps/web/src/routes/(app)/courses/[courseId]/assignments/[assignmentId]/` — entire subtree (detail, edit). LIST + `new/` stay.
- [ ] `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/` — entire subtree.
- [ ] `apps/web/src/routes/(app)/courses/[courseId]/manage/plagiarism/[assessmentSlug]/` — content moved to `/assignments/[assessmentId]/plagiarism/`

### Web — other
- [ ] `apps/web/src/routes/api/submissions/+server.ts` — drop `problemSlug` alias, rename `assessmentSlug` → `assessmentId`

### Web — components
- [ ] `apps/web/src/lib/components/problem/ProblemSolveView.svelte` — rename `assessment.assessmentSlug` → `assessmentId`, `contestSlug` → `contestId`
- [ ] `apps/web/src/lib/components/problem/Workspace.svelte` — same
- [ ] `apps/web/src/lib/components/problem/Editor.svelte` — same
- [ ] `apps/web/src/lib/components/problem/advanced/AdvancedModeWorkspace.svelte` — same, also fix `problemSlug: problem.id` (should be `problemId`)
- [ ] `apps/web/src/lib/components/course/assignment/AssignmentProblemsTab.svelte` — link href: change `/problems/${pid}?course=X&assessment=Y` → `/assignments/${assessmentId}/problems/${pid}`
- [ ] `apps/web/src/routes/(app)/courses/[courseId]/assignments/[assignmentId]/+page.svelte` — same link update

### Web — helpers & services
- [ ] `apps/web/src/lib/types.ts` — delete `assessmentPath(courseId, slug)`, add `assignmentPath(assessmentId)` / `contestPath(contestId)` / `examPath(examId)`
- [ ] `apps/web/src/lib/services/submission-service.ts` — rename fields, drop slug-alias comment

### Shared loader
- [ ] New `apps/web/src/lib/server/problem-solve.ts` — `loadProblemSolveData(problemId, context)` returning uniform `solveProps`

### Tests
- [ ] `tests/unit/core/course-schemas.test.ts` — rename field
- [ ] `tests/unit/core/session-identifiers.test.ts` — audit
- [ ] `tests/unit/domain/exam-session.test.ts`
- [ ] `tests/unit/domain/exam-auto-close.test.ts`
- [ ] `tests/unit/domain/submission-mutations.test.ts`
- [ ] `tests/unit/web/submission-queries.test.ts`
- [ ] `tests/integration/api/contests.test.ts` — `detail!.problems![0]!.slug` → `.id`
- [ ] `tests/integration/domain/contest-visibility.test.ts`
- [ ] New `tests/unit/domain/proctoring-gate.test.ts` — cover exam + contest variants of the helper

## Decisions

Resolved 2026-04-16:

1. **Seed direction** — **B: keep readable strings**. `problem_add-two-numbers`, `course_os-lab-spring-2026`, etc. remain as literal ids in seeds. They are just opaque cuid-role strings; readable ones happen to help dev debugging. No production impact (UI-created rows get real cuids).
2. **Title uniqueness within course** — **do not add `@@unique([courseId, title])`**. Slug uniqueness was a URL side-effect, not a business rule. Duplicate titles within a course are the teacher's problem to avoid via naming.
3. **Assignment/exam detail page** — **drop the `/courses/[courseId]/...` variant entirely**. Only `/assignments/[assessmentId]` and `/exams/[examId]` exist. Teacher management UI and student overview share the same top-level route with role-gated tabs. Course-scoped list pages (`/courses/[courseId]/assignments/`, `/courses/[courseId]/exams/`) and creation pages (`/courses/[courseId]/<kind>/new`) stay because they need courseId context from the URL.
4. **Contest proctoring** — **full parity with exam**. Contest schema gains the proctoring fields (`pageLock`, `ipBinding`, `ipWhitelist`, `ipViolationMode`, etc.). Proctoring logic extracted into a shared helper (`packages/domain/src/proctoring/`) consumed by both exam and contest layouts. IP violations continue logging via `IpViolationLog` (already has both `contestId` and `assessmentId` FKs).

## Verification Gates

Each phase ends with:
- `pnpm -w typecheck` → 0 errors
- `pnpm -w lint` → clean
- `pnpm -w format` → clean
- `pnpm test:unit` + `pnpm test:integration` → green
- Spot-check dev server manually for the rerouted pages (practice solve, assignment solve, contest solve, exam solve, contest scoreboard)

Phase 3 (proctoring) additionally requires:
- `tests/unit/domain/proctoring-gate.test.ts` green with cases for exam + contest variants
- Manual IP-violation smoke test on a running exam (regression check)

Phase 5 (schema drop) additionally requires:
- A fresh `pnpm db:push` on a scratch DB succeeds
- Existing dev DB migration applies without error

## References

- [Architecture Overview](../../ARCHITECTURE.md)
- [Database Schema](../../DATABASE.md)
- [Frontend Surface](../../FRONTEND.md)
- [Reliability Invariants](../../RELIABILITY.md) — if contest proctoring is added, update this
