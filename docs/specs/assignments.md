# Feature: Course Assignments

Acceptance spec for course-embedded homework assessments (`CourseAssessment` /
`/courses/[courseId]/assignments/...`). Assignments are un-proctored
take-home work — no session gate, no IP lock, no page lock. Deadlines and
per-day attempt caps are the only controls; practice-after-close grants
viewing + un-scored submission to past participants.

## User Stories

- As a **teacher** or **TA**, I want to stand up an assignment in `draft`
  status and iterate on problems + timing without it appearing on student
  lists, so that I can prep next week's homework in public view only once
  it's ready.
- As a **teacher** or **TA**, I want to `publish` an assignment once it has
  problems, allowed languages, and a sane time window, so that students get
  a consistent, vetted drop instead of half-built drafts.
- As a **student**, I want to see my enrolled course's open assignments with
  a per-assignment "solved / total" badge and the close deadline, so that I
  know what's due and what I've already cleared.
- As a **teacher**, I want `classStats` on the assignment list (submitted
  students / total students / average score) so that I can eyeball class
  progress without opening each assignment.
- As a **student**, I want to keep viewing and submitting to an ended
  assignment's problems for practice, so that I can still learn the material
  after the deadline without it affecting scores.
- As a **teacher**, I want old semesters' assignments to fall out of student
  lists once the parent course is archived, without losing submission
  history. (Assignments themselves have no archive flag — the parent
  `Course.archived` cascades.)
- As a **teacher**, I want `delete-draft` that only works while the
  assignment has never been shipped, so that destructive operations never
  wipe real grades.

## Scope

### In scope

- `CourseAssessment` CRUD — create, partial update (status-aware), publish,
  delete-draft, revert-to-draft (only while `upcoming`).
- Persistent `status` is `draft | published` only. Lifecycle derivation
  `draft | upcoming | open | closed` from `(status, opensAt, closesAt,
now)` — `closed` is purely `closesAt < now` and persists forever; there
  is no separate archived state at this level. When the parent course is
  archived (`Course.archived = true`), the assignment hides from student
  list views even if `closesAt` is in the future.
- Publish validation (≥1 problem, ≥1 allowed language, valid time window,
  `closesAt > now`, `opensAt < dueAt <= closesAt` when `dueAt` is set).
- Status-aware field locks:
  - `draft`/`upcoming` → all fields editable.
  - `open` → `opensAt` frozen; `closesAt`/`dueAt` extend-only.
  - `closed` → no field edits (only delete-draft is meaningful, and only
    for never-published rows).
- Per-assignment `maxAttemptsPerDay` (UTC midnight boundary).
- Per-assignment `allowedLanguages` subset of platform-supported list.
- `adjustmentRules` (e.g. late penalty decay) applied at submission score
  computation.
- Aggregated list views: `classStats` for managers, `myStatus` for students,
  including cross-course dashboard (`listAssignmentsAcrossCoursesForUser`).
- Practice-after-close read/write access via `assertProblemViewAccess`
  historical-participant gate.
- Problem attachment re-bind (wipe-and-recreate the
  `CourseAssessmentProblem` rows) with per-problem `points` override.
- Post-close grading drawer on the submissions matrix — score
  overrides + per-cell student-visible feedback comments
  (`SubmissionFeedback`). Writes gated post-close (`closesAt < now`),
  admin bypass.
- Audit sub-tab — staff-only merged feed of lifecycle, score
  override, and rejudge events
  (`listAuditTimelineForContext({ type: "assignment", id })`).

### Out of scope

- Proctoring (page lock, IP lock) — those live on `Exam` only.
- Session gate / heartbeat — assignments have no "start" ceremony.
- Scoreboard — assignments don't publish a leaderboard; teachers see the
  class-stats aggregate and the submission matrix instead.
- Plagiarism (Dolos) and editorials are covered by their own surfaces, not
  this spec.
- Late-submission flag in submission matrix — explicitly deferred per the
  practice-after-close design doc.

## Acceptance Criteria

### Lifecycle — publish

- GIVEN an assignment in `draft` with ≥1 attached problem, ≥1 allowed
  language, `closesAt > now`, and `opensAt < dueAt <= closesAt`,
  WHEN a teacher calls `publishAssignment`,
  THEN the row's `status` flips to `published` and no dispatch or job
  fires (assignments have no auto-close workflow).
- GIVEN an assignment in `draft` with 0 attached problems,
  WHEN publish is attempted,
  THEN `ValidationError("Attach at least one problem before publishing.")`.
- GIVEN an assignment in `draft` with an empty `allowedLanguages`,
  WHEN publish is attempted,
  THEN `ValidationError("Select at least one allowed language before publishing.")`.
- GIVEN an assignment whose `closesAt <= now`,
  WHEN publish is attempted,
  THEN `ValidationError("closesAt must be in the future.")`.
- GIVEN an assignment already in `published`,
  WHEN publish is attempted,
  THEN `ValidationError("Only draft assignments can be published.")`.

### Lifecycle — revert-to-draft

- GIVEN a `published` assignment whose `opensAt > now`,
  WHEN `revertAssignmentToDraft` is called,
  THEN status returns to `draft`.
- GIVEN a `published` assignment whose `opensAt <= now` (already open),
  WHEN revert is attempted,
  THEN `ValidationError("Cannot revert an assignment that has already opened.")`.

### Lifecycle — delete-draft

- GIVEN a `draft` assignment, WHEN `deleteAssignmentDraft` is called,
  THEN the row is hard-deleted (cascade drops
  `CourseAssessmentProblem` rows).
- GIVEN a non-`draft` assignment, WHEN delete is attempted,
  THEN `ValidationError("Only draft assignments can be deleted.")`.

### Lifecycle audit log

- GIVEN any user-driven lifecycle transition (`publish`,
  `revert_to_draft`, `delete_draft`), WHEN the mutation transaction
  commits, THEN an append-only `AssessmentAuditLog` row is written in the
  same transaction: `{ assessmentId, courseId, actorUserId, action }`.
- GIVEN the Temporal lifecycle workflow auto-publishes an assignment at
  its scheduled `opensAt`, WHEN `markAssignmentPublished` runs, THEN it
  writes an audit row with `action: 'publish'` and `actorUserId: null`
  (null = system transition, no human actor).
- GIVEN a `delete_draft`, THEN the audit row is written BEFORE the
  `CourseAssessment` row is removed; `assessmentId` is stored as a plain
  string (not an FK) so the entry survives the deletion.
- WHEN the assignment settings tab loads, THEN
  `assessmentAuditLogRepo.listByAssessment(assessmentId, take)` returns
  the most recent entries (newest first) with the actor's display name
  for the lifecycle history list.

### Update — status-aware field locks

- GIVEN an `open` assignment, WHEN `updateAssignmentRecord` receives a
  `closesAt` earlier than the current `closesAt`,
  THEN `ValidationError("closesAt can only be extended, not moved earlier.")`.
- GIVEN an `open` assignment, WHEN the payload changes `opensAt`,
  THEN `ValidationError("opensAt cannot be changed once the assignment is open.")`.
- GIVEN an `open` assignment, WHEN the payload sets `dueAt` earlier than
  the current `dueAt`,
  THEN `ValidationError("dueAt can only be extended, not moved earlier.")`.
- GIVEN a `closed` assignment (`closesAt < now`), WHEN
  `updateAssignmentRecord` is called, THEN the mutation is rejected — a
  closed assignment is read-only forever.

### Permissions

- GIVEN a non-owner non-admin actor without active teacher/TA membership on
  the hosting course, WHEN any assignment mutation is called,
  THEN `ForbiddenError("You do not have permission to edit this assignment.")`.
- GIVEN a student actor, WHEN they call any mutation on an assessment,
  THEN the same `ForbiddenError` fires (defense-in-depth — routes gate too).

### Problem attachment

- WHEN `updateAssignmentRecord` includes `problemIds`, THEN all existing
  `CourseAssessmentProblem` rows are deleted, then re-created preserving the
  submitted order as `ordinal = index + 1` with per-row `points` (default 100).
- GIVEN `allowedLanguages` is non-empty and any attached problem is
  missing an editable `main.<ext>` for one of those languages,
  THEN `ValidationError(...missing editable main.<ext>...)` before any row
  write.

### Visibility & list aggregation

- GIVEN a student on the assignments list, WHEN `listAssignmentsForCourse`
  runs with `includeDrafts=false`, THEN no `draft` rows appear and
  `counts.draft === null`.
- GIVEN a teacher, WHEN `includeDrafts=true`, THEN drafts are included and
  `counts.draft` is populated.
- GIVEN a manager viewer, WHEN rows are returned, THEN `classStats` is
  set and `myStatus === null`.
- GIVEN a student viewer, WHEN rows are returned, THEN `myStatus` is set
  and `classStats === null`.
- GIVEN the viewer has no active course memberships, WHEN
  `listAssignmentsAcrossCoursesForUser` runs,
  THEN `hasNoCourses === true` and `rows` / `counts` are zeroed.

### Grading — post-close drawer

- GIVEN an `open` assignment (`closesAt > now`), WHEN a manager opens
  the submissions matrix, THEN the "Open grading" entry button is
  hidden and a "grading available after close" note is shown in its
  place. The drawer cannot be opened.
- GIVEN a `closed` assignment, WHEN a manager opens a matrix cell,
  THEN the grading drawer shows two sections — score override
  (staff-only `reason`) + student-visible feedback comment — keyed
  on `(studentUserId, problemId, courseAssessmentId)`.
- GIVEN a non-admin manager actor with `now < closesAt`, WHEN
  `createOverride` / `updateOverride` / `deleteOverride` or
  `upsertFeedback` / `deleteFeedback` is called against the
  assignment, THEN `ConflictError("This context is still open; grading
is only available after it closes.")` (shared post-close gate; see
  `assertContextClosed`). `platformRole === "admin"` bypasses the
  gate.
- WHEN `getFeedbackForStudent` is called by a student while the
  assignment is still open, THEN it returns nothing; once
  `closesAt < now`, the per-problem comment is surfaced on the
  assignment detail page and on the submission detail page.

### Audit timeline

- GIVEN a staff viewer (course teacher/TA or platform admin), WHEN
  they open the Audit sub-tab on the assignment manage page, THEN
  `listAuditTimelineForContext({ type: "assignment", id })` returns a
  reverse-chronological merge of `AssessmentAuditLog` (lifecycle) +
  `ScoreOverrideAuditLog` (override changes) + `SubmissionRejudgeLog`
  (rejudges scoped to the assignment's submissions).
- The view is read-only — no new audit rows are written when the tab
  is loaded.

### Practice-after-close (submission gate)

- GIVEN an ended assignment (`closesAt < now`, `status = 'published'`) that
  the user has an `active` `CourseMembership` on,
  WHEN the user opens `/problems/[id]` for a problem that was attached,
  THEN `assertProblemViewAccess` allows the view via the historical-
  participant clause (no context query params needed).
- WHEN the user POSTs to `/api/submissions` with NO assignment context on
  the same problem after close, THEN the submission is accepted as a
  practice submission (no `courseAssessmentId`, no `maxAttemptsPerDay`
  decrement, no class-stats contribution).
- GIVEN the same user POSTs with an EXPIRED `assessment` context,
  THEN the createSubmission mutation still throws `ForbiddenError` — the
  UI must not emit such URLs but the backend is belt-and-braces.

## Edge Cases & Failure Modes

- **Draft with `null` dueAt.** Zod schema allows `dueAt` optional; the
  publish path enforces `opensAt < dueAt <= closesAt` only when `dueAt` is
  set. A draft saved with no `dueAt` publishes cleanly.
- **Update to allowedLanguages removes a language for which submissions
  already exist.** Allowed — the historical submission rows keep their
  language. Future submissions must use the reduced set.
- **Two teachers publish the same draft concurrently.** The second call
  reads `status === 'published'` and throws
  `ValidationError("Only draft assignments can be published.")` — no race
  hazard because the check and write are in the same transaction.
- **`maxAttemptsPerDay` boundary.** The UTC-midnight window is exclusive of
  the new day's 00:00:00 (a `createdAt >= start-of-day` filter), so a
  student submitting at 23:59:59 on day N and 00:00:00 on day N+1 gets two
  attempts, not one.
- **Archived course, published assignment.** When the parent
  `Course.archived` flips true, the assignment hides from student list
  views and submissions to it are rejected by the submissions path. The
  assignment row itself stays `published`; it just stops being addressable
  by students until the course is unarchived.

## Implementation References

### Domain

- `packages/domain/src/assignment/mutations.ts` —
  `updateAssignmentRecord`, `publishAssignment`, `deleteAssignmentDraft`,
  `revertAssignmentToDraft`, `markAssignmentPublished` (Temporal
  auto-publish; writes a system audit row), `assertFieldsAllowedForStatus`
  (status-aware lock), `deriveLiveStatus`.
- `packages/db/src/repositories/assessment-audit.ts` —
  `assessmentAuditLogRepo` (`withTx().create`, `listByAssessment`).
- `packages/domain/src/course/mutations.ts` —
  `createCourseAssessmentRecord` (initial insert; generates slug-style id).
- `packages/domain/src/course/overview.ts` —
  `listAssignmentOverviewForCourse`, `listAssignmentsForCourse`,
  `mapAssignmentToOverviewRow` (internal helper), rank function.
- `packages/domain/src/course/across-courses.ts` —
  `listAssignmentsAcrossCoursesForUser` (dashboard surface).
- `packages/domain/src/shared/list-aggregations.ts` —
  `aggregateAssignmentClassStats`, `aggregateAssignmentMyStatus`.
- `packages/domain/src/problem/permissions.ts` — `assertProblemViewAccess`
  (practice-after-close historical-participant gate).
- `packages/domain/src/feedback/` — `upsertFeedback`,
  `deleteFeedback`, `listFeedbackForContext`,
  `getFeedbackForStudent`, `assertCanWriteFeedback` (role + post-close
  gate), `assertCanViewFeedback` (role-only).
- `packages/domain/src/score-override/permissions.ts` —
  `assertCanSetScoreOverride` (role + post-close gate),
  `assertCanViewScoreOverrides` (role-only).
- `packages/domain/src/shared/context-window.ts` — `isContextClosed`,
  `assertContextClosed` (shared post-close gate across assignment +
  exam + contest).
- `packages/domain/src/audit/queries.ts` —
  `listAuditTimelineForContext`.

### Schema

- `packages/core/src/schemas/course.ts` — `courseAssessmentCreateSchema`,
  `courseAssessmentUpdateSchema`, `courseAssignmentFormSchema`,
  `assessmentSettingsFormSchema`.
- `packages/db/prisma/schema/course.prisma` — `CourseAssessment`,
  `CourseAssessmentProblem`, `AssessmentAuditLog`, enum
  `AssessmentAuditAction`.
- `packages/db/prisma/schema/submission.prisma` —
  `SubmissionFeedback` (assignment + exam contexts; CHECK enforces
  exactly one context column is non-null).
- `packages/core/src/schemas/feedback.ts` — `feedbackUpsertSchema`.

### Routes / API

- `apps/web/src/routes/(app)/assignments/[assignmentId]/+page.server.ts`
  — all lifecycle + settings form actions.
- `apps/web/src/routes/(app)/courses/[courseId]/assignments/` — per-course
  list and create flows.
- `apps/web/src/routes/(app)/assignments/+page.svelte` — cross-course
  dashboard.

### Tests

- `tests/unit/domain/assignment-mutations.test.ts` — publish / delete /
  revert-to-draft / status-aware field locks + audit-row writes,
  including the `markAssignmentPublished` system path.
- `tests/unit/domain/list-aggregations.test.ts` — class stats + my status
  aggregations.
- `tests/unit/domain/problem-access.test.ts` — practice-after-close gate.

## Open Questions / TODO

- Teachers currently cannot see practice (post-close, context-less)
  submissions from their students in any matrix view — this is
  intentional per the design doc, but may become a feature request.
