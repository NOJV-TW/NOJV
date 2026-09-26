# Feature: Course Assignments

Acceptance spec for course homework (`Assessment`, routes `/assignments/[assignmentId]` and `/courses/[courseId]/assignments`). Assignments are unproctored: no session, IP or page lock. Controls are the time window, late policy and per-problem daily attempt caps. After close, past participants keep practice access without affecting grades.

## Key code

- `packages/application/src/assignment/mutations.ts` — `updateAssignmentRecord`, `publishAssignment`, `revertAssignmentToDraft`, `deleteAssignmentDraft`, status-aware field locks
- `packages/application/src/scoring/activity-grading.ts`, `scoring/activity-points.ts` — allocation save/validation and weighted official score
- `packages/application/src/problem/fork.ts` — `resolveActivityProblems` (reuse, fork, library sharing)
- `packages/application/src/course/overview.ts`, `course/across-courses.ts`, `shared/list-aggregations.ts` — list views, `classStats`, `myStatus`
- `packages/application/src/feedback/`, `score-override/permissions.ts`, `shared/context-window.ts` — post-close grading gate
- `packages/application/src/audit/queries.ts` — `listAuditTimelineForContext`
- `packages/application/src/problem/permissions.ts` — `assertProblemViewAccess` (practice after close)
- `packages/application/src/submission/attempt-window.ts` — daily attempt window
- `packages/core/src/schemas/course.ts`, `schemas/activity-grading.ts`; `packages/db/prisma/schema/course.prisma` (`Assessment`, `AssessmentProblem`, `AssessmentAuditLog`)
- Routes: `apps/web/src/routes/(app)/assignments/[assignmentId]/+page.server.ts` (lifecycle and settings actions), `apps/web/src/routes/(app)/courses/[courseId]/assignments/`, `apps/web/src/routes/(app)/assignments/` (cross-course list)
- Tests: `tests/unit/application/assignment-mutations.test.ts`, `assignment-submissions-matrix.test.ts`, `list-aggregations.test.ts`, `problem-access.test.ts`

## Model

- Persistent `status` is `draft | published`. Live status derives from `(status, opensAt, closesAt, now)`: `draft`, `upcoming` (`opensAt > now`), `open`, `closed` (`closesAt < now`). There is no assignment archive state; an archived parent course hides its assignments from students and rejects submissions and mutations.
- Settings: `allowedLanguages`, `maxAttemptsPerDay`, `attemptResetMinuteOfDay` (minutes after Taipei midnight, default 300 = 05:00), `dueAt`, `closesAt`, `adjustmentRules` (late penalty; see [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#adjustment-rules)).
- Publishing ensures the due-soon reminder workflow; changing `opensAt`/`closesAt` on a published assignment replaces it; revert and delete cancel it.

Out of scope: proctoring and sessions (exam only), scoreboards, a late flag in the matrix (PRB-20). Plagiarism and posts have their own specs.

## Acceptance criteria

### Activity allocation and official scores

Shared by assignments and exams (ASM-16).

- The activity total is the server-derived sum of per-problem `points` (0 with no problems). Clients send only `problems: [{ problemId, points }]` plus `gradingRevision`; they cannot set the total. The editor shows points below the problem list, to two decimal places; new selections start at 100.
- Allocation rows: at most 64, unique problems, points 0–1e9. Drafts may save any allocation, including a zero total. Publishing, and saving a published activity, require a total greater than 0.
- Official score per problem = effective raw score (best non-sample submission, after late adjustment, or raw override) / problem raw maximum × allocation. Decimals are kept until the activity total, which is rounded half up to two places. Example: 80/100 and 50/100 with allocations 40 and 60 give 62.
- A zero-point problem contributes 0; its solved state still follows the raw score. Missing submissions stay missing. Practice after close contributes nothing.
- Adding, removing or reordering problems keeps other allocations and recomputes the total. Stored precision is displayed as is.
- Grading changes need no reason and write no allocation audit log. A stale `gradingRevision` fails with `ConflictError` and writes nothing. Closed activities accept grading changes without reopening other settings.
- Removing a problem removes only the link; submissions, overrides and feedback survive. Reattaching the same problem ID (tracked in `detachedProblemIds`) restores its identity. Editing allocations as another course manager never forks an attached problem.
- Details, matrices, gradebook and CSV, lists and analytics all use the same weighted official score; submission records keep the raw scale.

### Problem ownership and forks

Rules come from PRB-10 and PRB-11; data model in [Database](../architecture/DATABASE.md).

- An actor-owned private problem, or a private problem already shared with the course, is attached as is and its `CourseProblem` relation is kept or created. Newly selected private problems must be published.
- A newly selected published public problem, including the actor's own, becomes an actor-owned private draft fork shared with the course.
- References already on the activity in the DB (including historical public problems and private drafts) keep their IDs. Pickers offer published candidates only; client-supplied IDs never count as existing.
- Any other private problem, or any later failure, rolls back the activity, forks and new library relations together.
- Detaching a problem or deleting a draft assignment keeps the library relation. Library removal is separate and is rejected while activities or their history reference the problem.
- The staff-only course library at `/courses/[courseId]/problems` accepts the owner's private drafts, shows owner, source and activity links, and has no create-problem button. Archived courses keep it readable without edit, add or remove controls.

### Late collection

- Forms show the on-time deadline and an allow-late toggle. Disabled: final deadline equals on-time deadline and no penalty is saved. Enabled: a final collection time strictly after `dueAt` is required.
- Penalty is none, a fixed percentage or a daily percentage (at most one late rule). Penalties start strictly after `dueAt`; a partial 24-hour day counts as a whole day; exactly `dueAt` is on time.
- Submissions at or after `closesAt` are rejected as official submissions. Closing never resets an earned grade.
- While open, `dueAt`/`closesAt` may only be extended and penalties cannot change (`"Late penalties cannot be changed once the assignment is open."`). Partial updates validate the merged persisted and requested settings.
- Overview and workspace show both deadlines, the penalty terms and the switch to late collection.

### Publish

- GIVEN a draft with ≥1 problem, ≥1 allowed language, a positive total, `closesAt > now` and `opensAt < dueAt <= closesAt` (when `dueAt` is set), WHEN `publishAssignment` runs, THEN `status` becomes `published` and a `publish` audit row is written.
- Failures, all `ValidationError`: not draft → `"Only draft assignments can be published."`; no languages → `"Select at least one allowed language before publishing."`; no problems → `"Attach at least one problem before publishing."`; `closesAt <= now` → `"closesAt must be in the future."`.
- Check and write run in one locked transaction, so a concurrent second publish fails with the not-draft error.
- A draft with no `dueAt` publishes; the window check applies only when `dueAt` is set.

### Revert to draft and delete draft

- `revertAssignmentToDraft` works only on a published assignment with `opensAt > now`; otherwise `"Only published assignments can be reverted to draft."` or `"Cannot revert an assignment that has already opened."`.
- `deleteAssignmentDraft` hard-deletes a draft (cascading `AssessmentProblem`); otherwise `"Only draft assignments can be deleted."`.

### Lifecycle audit log

- `publish`, `revert_to_draft` and `delete_draft` each append an `AssessmentAuditLog` row `{ assessmentId, courseId, actorUserId, action }` in the mutation transaction (ASM-14).
- For `delete_draft` the row is written before the delete; `assessmentId` is a plain string, so the row outlives the assignment.

### Field locks by live status

- `draft`, `upcoming`: all fields editable.
- `open`: `opensAt` frozen (`"opensAt cannot be changed once the assignment is open."`); `closesAt` and `dueAt` extend only (`"closesAt can only be extended, not moved earlier."`, `"dueAt can only be extended, not moved earlier."`).
- `closed`: only `problems` and `gradingRevision` may change; anything else fails with `"Closed assignments are read-only."`.

### Permissions

- Mutations require a bound, active teacher/TA membership in the course or effective admin access. Course ownership or being the creator grants nothing; pending usernames and removed memberships grant nothing; a platform student who is an active TA is allowed.
- Archived courses reject activity mutations even for staff.

### Problem attachment

- `problems` in `updateAssignmentRecord` updates retained links in place, detaches removed ones, attaches new ones under the ownership rules, and sets `ordinal = index + 1`.
- With non-empty `allowedLanguages`, a newly attached `multi_file` problem missing an editable `main.<ext>` for an allowed language fails before any write.

### Attempt limits

- `maxAttemptsPerDay` counts per `(student, assignment, problem)` from the window start at `attemptResetMinuteOfDay` Taipei time (fixed UTC+8). The count runs under a per-window advisory lock, so concurrent submits cannot exceed the cap.
- Sample-only runs never count. `system_error` never counts, including submissions swept to `system_error` by the stale-submission sweeper (PRB-16).

### Lists and aggregation

- Students (`includeDrafts=false`) never see drafts and get `counts.draft === null`; staff (`includeDrafts=true`) see drafts and counts.
- Staff rows carry `classStats` (submitted students, total students, average score) and `myStatus === null`; student rows carry `myStatus` (solved/total) and `classStats === null`.
- `listAssignmentsAcrossCoursesForUser` for a user without active memberships returns `hasNoCourses === true` with zeroed rows and counts.

### Grading after close

- While `closesAt > now` the matrix hides the grading entry and shows a "grading available after close" note.
- After close, a matrix cell opens the drawer with a score override (staff-only reason) and a student-visible feedback comment, keyed by `(course membership, problemId, assessmentId)`.
- Non-admin override or feedback writes before close fail with `ConflictError("This context is still open; grading is only available after it closes.")` via `assertContextClosed`; platform admins bypass (ASM-18).
- Pending (unlinked) roster students can receive manual scores and feedback after close.
- Students get feedback only after close, on the assignment detail page and the submission detail page.

### Audit timeline

- Staff (course teacher/TA or admin) see a read-only, newest-first merge of `AssessmentAuditLog`, `ScoreOverrideAuditLog` and `SubmissionRejudgeLog` for the assignment's submissions. Loading it writes nothing.

### Rejudge

- Batch rejudge runs children in batches of 10 and exposes `{ completed, total }` progress that the manage page polls. Cancelling cancels in-flight children and restores affected submissions to their prior verdict. Every rejudge writes a `SubmissionRejudgeLog` row (PRB-18). Pipeline details: [Judge Pipeline](../architecture/JUDGE_PIPELINE.md).

### Practice after close

- For a published, closed assignment and a user with an active course membership, `/problems/[id]` for an attached problem is viewable through the historical-participant clause of `assertProblemViewAccess` (PRB-20).
- A context-less `POST /api/submissions` on that problem is accepted as practice: no `assessmentId`, no attempt count, no stats or grade contribution.
- The closed-assignment matrix shows these practice submissions as metadata in the student/problem cell without changing the official score, total, class stats, overrides or feedback.
- A submission that still names the expired assignment context fails with `ForbiddenError`.
