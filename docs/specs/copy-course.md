# Feature: Copy Course

Acceptance spec for `courseDomain.copyCourse` — a single-transaction clone
of a course's structural scaffolding into a brand-new course. Covers the
Settings-tab action that lets a teacher fork a prior semester's course
into a fresh one without dragging history along.

## User Stories

- As a **teacher** or **TA**, I want to duplicate my previous semester's
  course with its assignments, exams, and problem attachments but WITHOUT
  the old roster, submissions, or join tokens, so that I can prep a fresh
  term in one click and edit times + content before publishing.
- As the **actor performing the copy**, I want to become the sole teacher
  of the new course, regardless of who I was in the source course, so that
  the new course is unambiguously mine to manage.
- As a **teacher**, I want every copied assignment and exam to start as
  `draft`, so that nothing auto-publishes with stale timing.
- As a **teacher**, I want the copy to run as a single database
  transaction, so that a mid-clone failure leaves zero partial state
  behind.

## Scope

### In scope — what gets copied

- `Course` — new row with `title = \`${source.title} (copy)\``,
`description = source.description`, `ownerId = actor.userId`,
`archived = false` (defaults).
- `CourseMembership` — exactly one row: actor → `teacher`, `status:
'active'`. No other members copied.
- `CourseAssessment` rows — ALL statuses of the source (including
  `published` and `archived`) are cloned, each reset to `status:
'draft'`. Carried fields: `title`, `summary`, `allowedLanguages`,
  `opensAt`, `closesAt`, `dueAt`, `maxAttemptsPerDay`,
  `adjustmentRules`.
- `CourseAssessmentProblem` rows — every attached problem on every
  cloned assessment, preserving `ordinal` and `points`. Problem rows
  themselves are shared by reference (same `problemId`).
- `Exam` rows — ALL statuses cloned, each reset to `status: 'draft'`.
  Carried fields: `title`, `summary`, `startsAt`, `endsAt`,
  `allowedLanguages`, `scoringMode`, `scoreboardMode`,
  `submitCooldownSec`, all proctoring fields (`pageLockEnabled`,
  `ipBindingEnabled`, `ipWhitelistEnabled`, `ipWhitelist`,
  `ipViolationMode`).
- `ExamProblem` rows — every attached problem, preserving `ordinal`
  and `points`.

### Out of scope — explicitly NOT copied

- Other `CourseMembership` rows (students, other teachers, TAs).
- `Submission` rows (tied to the source course via
  `courseAssessmentId` / `examId`).
- `ContestParticipation` / `ExamParticipation` / `ActiveExamSession`
  rows.
- `IpViolationLog` rows.
- `CourseAnnouncement` rows.
- `PlagiarismReport` rows (fields on `Exam`/`Contest` are reset by
  default because we don't clone them).
- Source-course join tokens (the Phase-5 teacher-paste-handle flow
  replaced tokens, but either way they don't carry over).

## Acceptance Criteria

### Permission

- GIVEN an actor who is not a `teacher` / `ta` of the source course AND
  not a platform `admin`, WHEN `copyCourse(actor, sourceId)` is called,
  THEN `ForbiddenError("You do not have permission to manage this course.")`.
- GIVEN a platform admin, WHEN copy runs, THEN allowed even without
  course membership.
- GIVEN a `teacher` or `ta` membership with `status: 'active'`, THEN
  allowed.
- GIVEN a `student` membership, THEN denied.

### Source existence

- GIVEN a `sourceCourseId` that does not exist, WHEN copy runs,
  THEN `NotFoundError(\`Course not found: ${sourceCourseId}\`)`.

### New course row

- WHEN copy succeeds, THEN a new `Course` row exists with:
  - `title === \`${source.title} (copy)\``.
  - `description === source.description`.
  - `ownerId === actor.userId`.
  - `archived === false` (default; source `archived` is NOT carried).
- WHEN copy succeeds, THEN the return value is `{ newCourseId: string }`.

### Membership

- WHEN copy succeeds, THEN exactly ONE `CourseMembership` exists on the
  new course: `(userId: actor.userId, role: 'teacher', status: 'active',
addedByUserId: actor.userId)`.

### Assessment clones

- For each `CourseAssessment` in the source, regardless of its `status`,
  a new row exists on the new course with:
  - Same `title`, `summary`, `allowedLanguages`, `opensAt`, `closesAt`,
    `dueAt`, `maxAttemptsPerDay`, `adjustmentRules`.
  - `status: 'draft'` (always reset).
  - `createdByUserId: actor.userId` (not the original author).
  - Fresh `id` (slug regeneration — the domain code does NOT preserve
    the source id; assessmentRepo's `create` generates one).
- For each cloned assessment, every source `CourseAssessmentProblem`
  becomes a new row preserving `ordinal`, `points`, `problemId`.

### Exam clones

- For each `Exam` in the source, a new row exists on the new course with:
  - Same `title`, `summary`, `startsAt`, `endsAt`, `allowedLanguages`,
    `scoringMode`, `scoreboardMode`, `submitCooldownSec`, and all
    proctoring fields (`pageLockEnabled`, `ipBindingEnabled`,
    `ipWhitelistEnabled`, `ipWhitelist`, `ipViolationMode`).
  - `status: 'draft'` (always reset).
  - `createdByUserId: actor.userId`.
- For each cloned exam, every source `ExamProblem` becomes a new row
  preserving `ordinal`, `points`, `problemId`.
- No `ActiveExamSession`, `ExamParticipation`, or `IpViolationLog`
  rows are created for the new exam.

### Atomicity

- `copyCourse` runs inside a single `runTransaction` — if any step
  fails, the entire clone is rolled back: no new course, no new
  memberships, no new assessments, no new exams.

### Post-copy navigation

- After the Settings-tab `copyCourse` action succeeds, the route
  handler redirects via `303` to `/courses/${newCourseId}/settings`.
- Rate limiting applies (`consumeFormRateLimit`) — back-to-back calls
  will return the limiter's `fail(429, ...)` response.

## Edge Cases & Failure Modes

- **Source course with 0 assessments + 0 exams.** Copy succeeds; new
  course has just the teacher membership. Valid and tested.
- **Source has assessments pointing to `draft` problems.** Problem rows
  are shared (same `problemId`), so the new assessment references the
  same draft problem. The `assertCourseProblemAccess` gate in
  `createCourseAssessmentRecord` is NOT re-checked during `copyCourse`;
  since the actor already has manager access to the source course they
  implicitly passed that gate when the assessment was first attached.
- **Source has 10000 assessments.** The clone uses sequential `await`
  inside a transaction — this is intentional for correctness; extreme
  sizes may hit the Postgres statement-timeout. Not a real-world case.
- **Actor is the admin copying a course they have no membership in.**
  The admin short-circuit in `assertCourseManager` permits this; the
  new course's sole teacher will be the admin. If an admin copies on
  behalf of another teacher, they have to manually swap ownership
  afterward (future improvement).
- **Source's `archivedAt` / `archived: true`.** Archive state is NOT
  carried over; the new course is always active. This is intentional
  so the copy is immediately editable.
- **Source assessment's `adjustmentRules` JSON is malformed.** The
  domain assumes Prisma storage guarantees structural validity; a
  corrupted row would throw on re-serialization and the whole tx rolls
  back. No special handling.
- **Concurrent copy calls on the same source course.** Both succeed
  (they create different `newCourseId`s). The source is read-only in
  this flow; no lock needed.

## Implementation References

### Domain

- `packages/domain/src/course/mutations.ts` — `copyCourse` (whole
  function body lives here, ~90 lines under the `export async function
copyCourse` comment block).
- `packages/domain/src/course/mutations.ts` — `assertCourseManager`
  (permission gate reused by copy + other course mutations).
- `packages/domain/src/user/mutations.ts` — `ensureUser` (used to
  materialize the actor record inside the tx).

### Schema

- `packages/db/src/repositories/course.ts` — `courseRepo.create`.
- `packages/db/src/repositories/assessment.ts` —
  `assessmentRepo.listByCourseIdAllWithProblems`, `create`.
- `packages/db/src/repositories/exam.ts` —
  `examRepo.listByCourseIdAllWithProblems`, `create`.
- `packages/db/src/repositories/course-membership.ts` —
  `courseMembershipRepo.create`.
- `packages/db/src/repositories/assessment-problem.ts`,
  `exam-problem.ts` — `.create`.

### Routes / API

- `apps/web/src/routes/(app)/courses/[courseId]/settings/+page.server.ts`
  — `copyCourse` action (calls `courseDomain.copyCourse`, redirects to
  `/courses/${newCourseId}/settings`).
- `apps/web/src/routes/(app)/courses/[courseId]/settings/+page.svelte`
  — the button that POSTs to the action.

### Tests

- `tests/unit/domain/course-copy.test.ts` — 10+ scenarios covering
  permission gating, field carry, status reset, membership shape,
  problem-attachment order / points preservation, empty-source case.

## Open Questions / TODO

- Copy currently renames with a hard-coded `(copy)` suffix. If someone
  copies a copy they get `"Foo (copy) (copy)"`. A future nicer flow
  would let the caller supply the new title.
- The UI for copy is a single button; there is no preview of what WILL
  be copied vs what will be reset. Low-risk, but may surprise a
  teacher who expects the roster to carry over.
- Problems themselves are shared by reference. If a TA later edits a
  shared problem, the edit affects BOTH the source course's and the
  copied course's published assessments. This is the current product
  contract — problems are platform-level, not course-level — but it's
  worth surfacing to teachers via docs or UI copy.
