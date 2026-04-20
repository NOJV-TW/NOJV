# Feature: Plagiarism Detection

Acceptance spec for MOSS-based plagiarism detection on Exam and
CourseAssessment. Triggered by course staff; report state is inlined on
the parent row (no dedicated `PlagiarismReport` table). Runs as a
Temporal workflow keyed on target id — re-running terminates any
in-flight check for the same target.

Contest carries the same plagiarism columns for schema symmetry but the
UI never surfaces them — contests are public CP events. Homework
assignments and exams are the only surfaces with a "Run plagiarism"
button.

## User Stories

- As a **teacher**, **TA**, or **admin**, I want to trigger a plagiarism
  check on a closed assignment or exam, so that I can catch copy-paste
  submissions before finalizing grades.
- As a **teacher** or **TA**, I want to see similarity pairs (user A vs
  user B on problem P) with links back to MOSS, so that I can manually
  review flagged cases.
- As a **teacher**, I want re-running a plagiarism check to replace the
  previous result rather than stack up duplicates, so that the UI always
  reflects the latest run.
- As a **teacher**, I want to pull the source code for a flagged
  (student, problem) pair inline, so that I don't need to context-switch
  into the submissions page.
- As a **student**, I must not see plagiarism reports — not on the
  assignment detail tab, not via direct URL, not by inspecting the
  Temporal workflow state.

## Scope

### In scope

- Inline report state on `CourseAssessment.plagiarism*` and
  `Exam.plagiarism*` fields — six columns: `plagiarismStatus`,
  `plagiarismResults` (Json), `plagiarismMossReportUrl`,
  `plagiarismTriggeredAt`, `plagiarismCompletedAt`,
  `plagiarismTriggeredById`.
- State lifecycle `pending → running → completed | failed`, written by
  the Temporal activity at phase boundaries.
- POST `/api/plagiarism/[assessmentId]` (optional `?type=exam`)
  dispatches the workflow and sets status to `pending`.
- GET `/api/plagiarism/[assessmentId]` returns the latest report; with
  `?source=true&userId&problemId` returns a single source-code string.
- Permission gate `canManageCourse` (admin, platform teacher, course
  teacher, course TA) on both trigger and view paths.
- MOSS language mapping: `c/go/rust → c`, `cpp → cc`, `java → java`,
  `javascript/typescript → javascript`, `python → python`; any other
  `SupportedLanguage` value is silently skipped. MOSS treats `c` and
  `cc` as distinct languages, so C++ submissions never pair against C,
  Go, or Rust even on the same problem.
- Pre-MOSS deduplication: per `(userId, problemId)` keep only the
  highest-scoring `accepted` submission.
- Cross-group pairing is forbidden: submissions only compare against
  other submissions in the same `(problemId, MOSS language bucket)`.
- Results shape `{ pairs: SimilarityPair[] }` with each pair carrying
  both user ids, `problemId`, `similarity1`, `similarity2`,
  `linesMatched`, and `mossUrl`.
- Workflow id scheme `plagiarism-${targetType}-${targetId}` on
  `PLATFORM_TASK_QUEUE`; same-id redispatch terminates the prior run.
- Retry policy on the activity: `startToCloseTimeout: "10m"`,
  `maximumAttempts: 3`.

### Out of scope

- **Contests**: the schema columns exist but no UI route ever writes or
  reads them. A direct POST to a contest id is remapped to `type: exam`.
- **Student-visible results**: students never see plagiarism state.
- **Automatic scoring penalty**: detection only — rejecting a submission
  or zeroing a score is a separate manual action (rejudge or score
  override, see their specs).
- **Cross-assessment comparison**: MOSS runs per target; submissions
  from different assessments are never compared against each other.
- **Scheduled trigger**: no Temporal schedule fires plagiarism on
  assessment close; staff must click the button.
- **Push notification / email on completion**: UI polls.
- **Pair-level moderation state (false positive, reviewed, etc.)**: the
  current row is a snapshot, not a review workflow.

## Acceptance Criteria

### Trigger — permission gate

- GIVEN an actor with `canManageCourse === false` (student, non-member
  teacher on a different course, etc.),
  WHEN they POST `/api/plagiarism/[assessmentId]` for any target,
  THEN `ForbiddenError("Only course staff can trigger plagiarism checks.")`.
- GIVEN a platform admin (`platformRole: admin`),
  WHEN they POST for any assessment / exam in any course,
  THEN the trigger succeeds regardless of course membership.

### Trigger — target resolution

- GIVEN `?type=exam` and an id matching `Exam.id`,
  WHEN the route resolves the target,
  THEN `resolvePlagiarismTarget` returns `{ target: { type: "exam", id } }`.
- GIVEN `?type=exam` with an unknown id,
  WHEN the route resolves,
  THEN `PlagiarismNotFoundError("Exam not found.")`.
- GIVEN no `?type` query param (default `courseAssessment`) with an
  unknown id,
  WHEN the route resolves,
  THEN `PlagiarismNotFoundError("Assessment not found.")`.
- GIVEN `?type=contest` (legacy value),
  WHEN the route resolves,
  THEN it is remapped to `type: exam` — contests no longer have a
  distinct resolver.

### Workflow lifecycle

- GIVEN a successful trigger,
  WHEN `createPlagiarismReport(target, triggeredById)` writes the row,
  THEN `plagiarismStatus = pending`, `plagiarismResults` /
  `plagiarismMossReportUrl` / `plagiarismCompletedAt` are nulled, and
  `plagiarismTriggeredAt` + `plagiarismTriggeredById` are recorded.
- GIVEN a second POST for the same target while a run is in flight,
  WHEN `dispatchPlagiarismCheck` fires with the same workflow id,
  THEN Temporal's reuse policy terminates the prior run and the new one
  starts clean. The prior result JSON was already wiped at pre-trigger.
- GIVEN the activity begins,
  WHEN `updateReportStatus(target, "running")` writes,
  THEN subsequent GETs return `status: "running"`.
- GIVEN MOSS completes successfully,
  WHEN the activity calls `saveResults(target, { pairs }, mossReportUrl)`,
  THEN `plagiarismStatus = completed`,
  `plagiarismCompletedAt = now()`, `plagiarismResults` holds the pair
  list, and `plagiarismMossReportUrl` is set.
- GIVEN the activity throws (MOSS socket error, persist failure, etc.),
  WHEN the catch block runs,
  THEN `markReportFailed(target)` sets `plagiarismStatus = failed` and
  the workflow rethrows. After 3 retry attempts the workflow terminates
  in failed state.

### MOSS language mapping + grouping

- GIVEN submissions in `c`, `go`, `rust`,
  WHEN the activity groups by MOSS language,
  THEN they all bucket under `c` and are compared jointly per problem.
- GIVEN `cpp` submissions,
  WHEN grouping runs,
  THEN they land in the separate `cc` bucket — MOSS treats C and C++ as
  distinct languages, so C++ submissions never pair against C / Go /
  Rust even on the same problem.
- GIVEN submissions in an unmapped `SupportedLanguage`,
  WHEN grouping runs,
  THEN those submissions are silently skipped (no error, no failure).
- GIVEN only one submission survives a `(problem, language)` group after
  dedup,
  WHEN the activity iterates groups,
  THEN the group is skipped (MOSS needs ≥2 files); no pair is emitted.

### Results retrieval

- GIVEN a staff actor,
  WHEN they GET `/api/plagiarism/[assessmentId]`,
  THEN the response is `{ reports: [PlagiarismReportSummary | null] }`
  (array wrapper preserved for UI compatibility).
- GIVEN a staff actor with `?source=true&userId=X&problemId=Y`,
  WHEN the lookup hits,
  THEN the response is `{ sourceCode }`.
- GIVEN `?source=true` without both `userId` and `problemId`,
  WHEN the route validates,
  THEN a 400-class validation error is returned.
- GIVEN a student directly GETs the endpoint,
  WHEN the permission check runs,
  THEN `ForbiddenError("Only course staff can view plagiarism reports.")`.

### UI surface

- GIVEN a staff viewer with `report.status === "completed"` and a
  non-empty `pairs` list,
  WHEN the Plagiarism tab renders,
  THEN pairs are bucketed into High (similarity ≥ 70), Medium
  (50 ≤ sim < 70), and Low (< 50), rendered as histogram + table with
  the MOSS URL.
- GIVEN `report === null` (never triggered),
  WHEN the tab renders,
  THEN a "Run plagiarism check" CTA is shown.
- GIVEN `report.status` is `pending` or `running`,
  WHEN the tab renders,
  THEN a spinner + status label shows; polling cadence is controlled
  client-side.

## Edge Cases & Failure Modes

- **MOSS rate-limited / user id rejected**: activity throws
  `"MOSS rejected the language or user ID"`; Temporal retries up to 3
  times with exponential backoff; final state `failed`, staff can retry
  manually.
- **MOSS socket disconnect mid-response**:
  `"MOSS connection timed out"` or `"MOSS connection error"` — same
  retry path.
- **Re-trigger mid-flight**: `createPlagiarismReport` wipes prior
  results before the new workflow starts; no merging with a prior run.
- **Assessment deleted while workflow running**: parent row cascade
  wipes everything; the activity's next Prisma write misses, the
  workflow fails with an unrecoverable error, and there is nothing left
  in the UI to show.
- **Zero accepted submissions in the target**:
  `fetchSubmissionsForCheck` returns `[]`, the activity iterates no
  groups, persists `{ pairs: [] }` with `status = completed`. UI shows
  "no similarity found".
- **Source-code lookup for a deleted user**:
  `getPlagiarismSourceCode` returns `null`; UI falls back to a "source
  unavailable" placeholder.
- **Hand-crafted POST to `/api/plagiarism/[contestId]?type=contest`**:
  remapped to `type: exam` — unless the id collides with an `Exam.id`
  the response is `PlagiarismNotFoundError("Exam not found.")`.

## Implementation References

### Domain

- `packages/domain/src/plagiarism/index.ts` — exports
  `resolvePlagiarismTarget`, `createPlagiarismReport`,
  `fetchSubmissionsForCheck`, `findPlagiarismReport`,
  `updateReportStatus`, `saveResults`, `markReportFailed`,
  `getPlagiarismSourceCode`, `listAssessmentPlagiarismReports`,
  `getAssessmentProblemMap`.
- `packages/domain/src/shared/permissions.ts` —
  `resolveEffectiveCourseRole`, `canManageCourse`.

### Schema

- `packages/db/prisma/schema/ops.prisma` — `PlagiarismReportStatus`
  enum.
- `packages/db/prisma/schema/course.prisma` —
  `CourseAssessment.plagiarism*` columns.
- `packages/db/prisma/schema/contest.prisma` — `Exam.plagiarism*` plus
  unused `Contest.plagiarism*` columns.
- `packages/db/src/repositories/plagiarism.ts` — per-target
  `findBy*` / `upsertFor*` / `clearFor*` methods.

### Temporal

- `packages/temporal/src/workflows/plagiarism-check.ts` — workflow +
  `getPlagiarismStatusQuery`.
- `packages/temporal/src/activities/plagiarism.ts` —
  `runPlagiarismCheck`, MOSS socket protocol, language mapping.
- `packages/temporal/src/activity-options.ts` —
  `startToCloseTimeout: "10m"`, `maximumAttempts: 3`.
- `packages/job-dispatch/src/dispatch.ts` —
  `dispatchPlagiarismCheck` (workflow-id scheme).

### Routes / API

- `apps/web/src/routes/api/plagiarism/[assessmentId]/+server.ts` — POST
  trigger + GET report + GET source code.
- `apps/web/src/routes/(app)/assignments/[assessmentId]/+page.server.ts`
  — loads report for staff via
  `findPlagiarismReport(...).catch(() => null)`.
- `apps/web/src/lib/components/.../AssignmentPlagiarismReport.svelte` —
  histogram + table UI, bucketed by similarity.

### Tests

- `tests/unit/domain/plagiarism-queries.test.ts` — covers
  `resolvePlagiarismTarget` (exam / courseAssessment / legacy-contest
  remap / not-found paths) and `createPlagiarismReport` (pre-wipe
  contract + persistence-failure throw).
- `tests/unit/temporal/plagiarism-activity.test.ts` — covers the
  `runPlagiarismCheck` activity with the domain layer mocked: status
  bookkeeping, empty-submission short-circuit, best-score dedup, C /
  Go / Rust → `c` bucketing, cpp's separate `cc` bucket,
  skip-single-submission groups, unmapped-language skip, and the
  failure path that calls `markReportFailed` + rethrows.
- **Still missing**: route-level tests (permission gate for trigger /
  view / source fetch).

## Open Questions / TODO

- Contest plagiarism columns are dead weight — consider dropping
  `Contest.plagiarism*` in a schema cleanup pass to shrink the surface.
- Re-triggering silently discards prior pair data with no audit trail.
  If "did someone wipe evidence?" becomes a governance question, a
  `PlagiarismTriggerLog` table is needed.
- The activity currently writes placeholder `0, 0` similarity scores —
  actual MOSS report-URL scraping is still TODO. Until that lands, the
  UI's High/Medium/Low buckets will all report Low.
- MOSS is a third-party service with no SLA. A self-hosted fallback
  (e.g. JPlag) would remove the external dependency, at the cost of
  running and maintaining the binary in-house.
