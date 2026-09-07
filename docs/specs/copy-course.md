# Feature: Copy Course

Acceptance spec for `courseDomain.copyCourse` — a single-transaction clone
of a course's structural scaffolding into a brand-new course. Covers the
Settings-tab action that lets a teacher fork a prior semester's course
into a fresh one without dragging history along.

> **Problem ownership contract.** Copy reuses the actor's private problems.
> Every published public source, including the actor's own, becomes a new
> actor-owned private fork. Each distinct source is resolved once and reused
> across the copied activities. Source-course co-edit access does not authorize
> sharing another owner's private problem with the new course, even for admin.
> The new course, activities, forks and `CourseProblem` relations commit together.

See [Database](../architecture/DATABASE.md) and the
[problem permissions plan](../plans/active/2026-09-08-problem-permissions.md).

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

- `Course` — new row with `title = newTitle` (caller-supplied, trimmed,
  required, ≤120 chars — NOT auto-derived from the source title),
  `description = source.description`, `academicYear`, `semester`,
  `ownerId = actor.userId`, `archived = false` (defaults).
- `CourseMembership` — exactly one row: actor → `teacher`, `status:
'active'`. No other members copied.
- `Assessment` rows — every assessment of the source is cloned,
  each reset to `status: 'draft'`. (Assessments themselves no longer
  have an `archived` status; the parent course is what gets archived.)
  Carried fields: `title`, `summary`, `allowedLanguages`, `opensAt`,
  `closesAt`, `dueAt`, `maxAttemptsPerDay`, `adjustmentRules`.
- `AssessmentProblem` rows — every attached problem on every
  cloned assessment, preserving `ordinal` and `points`. `problemId` maps to
  the reused private problem or the newly created private fork.
- `Exam` rows — every exam of the source is cloned, each reset to
  `status: 'draft'`. (Exams no longer have an `archived` status either;
  the parent course is what gets archived.) Carried fields: `title`,
  `summary`, `startsAt`, `endsAt`, `allowedLanguages`, `scoringMode`,
  `scoreboardMode`, `submitCooldownSec`, all proctoring fields
  (`pageLockEnabled`, `ipBindingEnabled`, `ipWhitelistEnabled`,
  `ipWhitelist`, `ipViolationMode`).
- `ExamProblem` rows — every attached problem, preserving `ordinal`
  and `points`, using the same source-to-target problem mapping as assignments.
- `CourseProblem` rows — resolved activity problems are shared with the new course.

### Out of scope — explicitly NOT copied

- Other `CourseMembership` rows (students, other teachers, TAs).
- Library-only problems with no assignment or exam attachment.
- `Submission` rows (tied to the source course via
  `assessmentId` / `examId`).
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
  not a platform `admin`, WHEN `copyCourse(actor, sourceCourseId, newTitle)`
  is called,
  THEN `ForbiddenError("You do not have permission to manage this course.")`.
- GIVEN a platform admin, WHEN copy runs, THEN allowed even without
  course membership.
- GIVEN a `teacher` or `ta` membership with `status: 'active'` and
  `userId` bound to the actor, THEN allowed. Pending usernames and removed
  memberships grant no access.
- GIVEN a `student` membership, THEN denied.

### Source existence

- GIVEN a `sourceCourseId` that does not exist, WHEN copy runs,
  THEN `NotFoundError(\`Course not found: ${sourceCourseId}\`)`.

### New course row

- WHEN copy succeeds, THEN a new `Course` row exists with:
  - `title === newTitle.trim()` (caller-supplied; required and ≤120
    chars — a blank title throws `ValidationError("New course title is
required.")`, an over-length title throws `ValidationError("New
course title must be 120 characters or fewer.")`).
  - `description === source.description`.
  - `academicYear` / `semester` carried from the source when set.
  - `ownerId === actor.userId`.
  - `archived === false` (default; source `archived` is NOT carried).
- WHEN copy succeeds, THEN the return value is `{ newCourseId: string }`.

### Membership

- WHEN copy succeeds, THEN exactly ONE `CourseMembership` exists on the
  new course: `(userId: actor.userId, role: 'teacher', status: 'active',
addedByUserId: actor.userId)`.

### Assessment clones

- For each `Assessment` in the source (status is `draft` or
  `published` — there is no `archived` at this level), a new row exists
  on the new course with:
  - Same `title`, `summary`, `allowedLanguages`, `opensAt`, `closesAt`,
    `dueAt`, `maxAttemptsPerDay`, `adjustmentRules`.
  - `status: 'draft'` (always reset).
  - `createdByUserId: actor.userId` (not the original author).
  - Fresh `id` (slug regeneration — the domain code does NOT preserve
    the source id; assessmentRepo's `create` generates one).
- For each cloned assessment, every source `AssessmentProblem`
  becomes a new row preserving `ordinal` and `points`, with `problemId` resolved under the ownership contract.

### Exam clones

- For each `Exam` in the source (status is `draft` or `published`), a
  new row exists on the new course with:
  - Same `title`, `summary`, `startsAt`, `endsAt`, `allowedLanguages`,
    `scoringMode`, `scoreboardMode`, `submitCooldownSec`, and all
    proctoring fields (`pageLockEnabled`, `ipBindingEnabled`,
    `ipWhitelistEnabled`, `ipWhitelist`, `ipViolationMode`).
  - `status: 'draft'` (always reset).
  - `createdByUserId: actor.userId`.
- For each cloned exam, every source `ExamProblem` becomes a new row
  preserving `ordinal` and `points`, with `problemId` resolved under the ownership contract.
- No `ActiveExamSession`, `ExamParticipation`, or `IpViolationLog`
  rows are created for the new exam.

### Atomicity

- `copyCourse` runs inside a single `runTransaction` — if any step
  fails, the entire clone is rolled back: no new course, no new
  memberships, no new assessments, no new exams, forks or library relations.

### Post-copy navigation

- After the Settings-tab `copyCourse` action succeeds, the route
  handler redirects via `303` to `/courses/${newCourseId}/settings`.
- Rate limiting applies (the action is wrapped in `withRateLimit`) —
  back-to-back calls will return the limiter's `fail(429, ...)` response.

## Edge Cases & Failure Modes

- **Source course with 0 assessments + 0 exams.** Copy succeeds; new
  course has just the teacher membership. Valid and tested.
- **Source activities reference private drafts.** The actor's own private
  draft can be reused. Another owner's private draft is rejected; source-course
  management does not authorize sharing it with the target course. A public draft
  fails the published-public-source check. Any failure rolls back the full copy.
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
- **Concurrent copy calls on the same source course.** The source Course row
  is locked before authorization and reads. Copies serialize on that lock and
  create distinct target courses if both pass the ownership checks.

## Implementation References

### Domain

- `packages/application/src/course/mutations.ts` — `copyCourse`.
- `packages/application/src/problem/fork.ts` — `resolveActivityProblems`.
- `packages/application/src/course/mutations.ts` — `assertCourseManager`
  (permission gate reused by copy + other course mutations).
- `packages/application/src/shared/require.ts` — `requireUser` (requires the
  existing actor record inside the transaction; does not create a placeholder).

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
