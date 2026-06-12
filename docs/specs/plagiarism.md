# Feature: Plagiarism Detection

Acceptance spec for Dolos-based plagiarism detection on Exam and
Assessment. Triggered by course staff; report state is inlined on
the parent row (no dedicated `PlagiarismReport` table). Runs as a
Temporal workflow keyed on target id — re-running terminates any
in-flight check for the same target.

Contest also carries plagiarism columns and now exposes a manager-only
plagiarism sub-tab on the contest detail page that reuses the
`AssignmentPlagiarismReport` UI plus the pair-diff route. Homework
assignments, exams, and contests all expose a "Run plagiarism" button
for staff.

## User Stories

- As a **teacher**, **TA**, or **admin**, I want to trigger a plagiarism
  check on a closed assignment or exam, so that I can catch copy-paste
  submissions before finalizing grades.
- As a **teacher** or **TA**, I want to see similarity pairs (user A vs
  user B on problem P) with a numeric similarity score, so that I can
  rank and manually review flagged cases.
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

- Inline report state on `Assessment.plagiarism*`,
  `Exam.plagiarism*`, and `Contest.plagiarism*` fields — six columns:
  `plagiarismStatus`, `plagiarismResults` (Json), `plagiarismReportUrl`,
  `plagiarismTriggeredAt`, `plagiarismCompletedAt`,
  `plagiarismTriggeredById`. `plagiarismReportUrl` is always `null` for
  Dolos runs (everything is in-memory); the column is retained for
  schema stability and historical MOSS-era rows.
- Pair-level Monaco diff route shipped for all three context types
  (assessment, exam, contest). The shared route
  `apps/web/src/routes/(app)/plagiarism/pairs/[pairId]/+page.server.ts`
  resolves the pair against any of the three parents.
- Contest detail page exposes a manager-only `plagiarism` sub-tab
  (`apps/web/src/routes/(app)/contests/[contestId]/+page.svelte`) that
  reuses `AssignmentPlagiarismReport` with
  `diffContext = { type: "contest", id }`.
- State lifecycle `pending → running → completed | failed`, written by
  the Temporal activity at phase boundaries.
- POST `/api/plagiarism/[assignmentId]/reports` (optional `?type=exam`)
  dispatches the workflow, sets status to `pending`, and returns `202`.
- GET `/api/plagiarism/[assignmentId]/reports` returns the latest report.
- GET `/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]`
  returns a single source-code string for a flagged pair.
- Permission gate `canManageCourse` (admin, platform teacher, course
  teacher, course TA) on both trigger and view paths.
- Per-language native tree-sitter parser via Dolos: every
  `SupportedLanguage` (c, cpp, go, java, javascript, python, rust,
  typescript) maps to its own dedicated parser. No shared buckets, no
  secondary backend, and no unsupported-language fallback.
- Pre-analysis deduplication: per `(userId, problemId)` keep only the
  highest-scoring `accepted` submission.
- Cross-group pairing is forbidden: submissions only compare against
  other submissions in the same `(problemId, language)`.
- Results shape `{ pairs: SimilarityPair[] }` with each pair carrying
  `problemId`, `userId1`, `userId2`, `similarity` (0–100, symmetric),
  `longest` (longest common AST fragment in tokens), and `overlap`
  (total overlapping AST tokens).
- Workflow id scheme `plagiarism-${targetType}-${targetId}` on
  `PLATFORM_TASK_QUEUE`. `dispatchPlagiarismCheck` calls
  `client.workflow.start()` with no reuse/conflict policy, so a same-id
  redispatch while a run is in flight errors out (Temporal default) —
  it does NOT terminate-and-restart the prior run.
- Retry policy on the activity: `startToCloseTimeout: "10m"`,
  `maximumAttempts: 3`.
- Detection runs entirely in-process inside the worker container. No
  third-party network egress.

### Out of scope

- **Student-visible results**: students never see plagiarism state.
- **Automatic scoring penalty**: detection only — rejecting a submission
  or zeroing a score is a separate manual action (rejudge or score
  override, see their specs).
- **Cross-assessment comparison**: Dolos runs per target; submissions
  from different assessments are never compared against each other.
- **Cross-language pairing**: Dolos analyses one language per group;
  a Python submission never pairs against a Java submission.
- **Scheduled trigger**: no Temporal schedule fires plagiarism on
  assessment close; staff must click the button.
- **Push notification / email on completion**: UI polls.

## Acceptance Criteria

### Trigger — permission gate

- GIVEN an actor with `canManageCourse === false` (student, non-member
  teacher on a different course, etc.),
  WHEN they POST `/api/plagiarism/[assignmentId]/reports` for any target,
  THEN `ForbiddenError("Only staff can trigger plagiarism checks.")`.
- GIVEN a platform admin (`platformRole: admin`),
  WHEN they POST for any assessment / exam in any course,
  THEN the trigger succeeds regardless of course membership.

### Trigger — target resolution

- GIVEN `?type=exam` and an id matching `Exam.id`,
  WHEN the route resolves the target,
  THEN `getPlagiarismTarget` returns `{ target: { type: "exam", id } }`.
- GIVEN `?type=exam` with an unknown id,
  WHEN the route resolves,
  THEN it throws 404 `Exam not found.`.
- GIVEN `?type=contest` and an id matching `Contest.id`,
  WHEN the route resolves,
  THEN it returns `{ target: { type: "contest", id }, courseId: "" }` —
  contests are not course-bound, so the empty courseId falls callers
  back to platform-role checks.
- GIVEN `?type=contest` with an unknown id,
  WHEN the route resolves,
  THEN it throws 404 `Contest not found.`.
- GIVEN no `?type` query param (default `assessment`) with an
  unknown id,
  WHEN the route resolves,
  THEN it throws 404 `Assignment not found.`.

### Workflow lifecycle

- GIVEN a successful trigger,
  WHEN `createPlagiarismReport(target, triggeredById)` writes the row,
  THEN `plagiarismStatus = pending`, `plagiarismResults` /
  `plagiarismReportUrl` / `plagiarismCompletedAt` are nulled, and
  `plagiarismTriggeredAt` + `plagiarismTriggeredById` are recorded.
- GIVEN a second POST for the same target while a run is in flight,
  WHEN `dispatchPlagiarismCheck` fires with the same workflow id,
  THEN — because `client.workflow.start()` is called with no
  reuse/conflict policy — Temporal rejects the duplicate start (the
  in-flight run keeps going). The prior result JSON was already wiped at
  pre-trigger; a fresh run is possible once the prior one finishes.
- GIVEN the activity begins,
  WHEN `updateReportStatus(target, "running")` writes,
  THEN subsequent GETs return `status: "running"`.
- GIVEN Dolos completes successfully,
  WHEN the activity calls `saveResults(target, { pairs }, null)`,
  THEN `plagiarismStatus = completed`,
  `plagiarismCompletedAt = now()`, `plagiarismResults` holds the pair
  list, and `plagiarismReportUrl` stays `null`.
- GIVEN the activity throws (native addon load failure, persist
  failure, etc.),
  WHEN the catch block runs,
  THEN `markReportFailed(target)` sets `plagiarismStatus = failed` and
  the workflow rethrows. After 3 retry attempts the workflow terminates
  in failed state.

### Language grouping

- GIVEN submissions in `c`, `go`, `rust`,
  WHEN the activity groups by language,
  THEN each forms its own group and is parsed by its dedicated
  tree-sitter grammar. A C submission never pairs against a Go or Rust
  submission.
- GIVEN `cpp` submissions,
  WHEN grouping runs,
  THEN they land in their own `cpp` group with a dedicated C++ parser.
- GIVEN submissions in an unsupported language value,
  WHEN grouping runs,
  THEN the activity throws, marks the report `failed`, and lets Temporal
  retry. Unknown language values are not skipped.
- GIVEN only one submission survives a `(problem, language)` group after
  dedup,
  WHEN the activity iterates groups,
  THEN the group is skipped (Dolos needs ≥2 files); no pair is emitted.

### Results retrieval

- GIVEN a staff actor,
  WHEN they GET `/api/plagiarism/[assignmentId]/reports`,
  THEN the response is `{ reports: [PlagiarismReportSummary | null] }`
  (array wrapper preserved for UI compatibility).
- GIVEN a staff actor,
  WHEN they GET `/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]`,
  THEN the response is `{ files: SubmissionSource[] }` — one entry per
  file under the submission's S3 prefix. Multi-file submissions surface
  every path; single-file submissions return one entry.
- GIVEN a request to the sources path missing any of `assignmentId`,
  `userId`, or `problemId`,
  WHEN the route validates,
  THEN a 400-class error (`{ message: "Missing assignmentId, userId, or problemId." }`)
  is returned.
- GIVEN a student directly GETs the reports endpoint,
  WHEN the permission check runs,
  THEN `ForbiddenError("Only staff can view plagiarism reports.")` (the
  sources path uses `"Only staff can view plagiarism source code."`).

### UI surface

- GIVEN a staff viewer with `report.status === "completed"` and a
  non-empty `pairs` list,
  WHEN the Plagiarism tab renders,
  THEN pairs are bucketed into High (similarity ≥ 70), Medium
  (50 ≤ sim < 70), and Low (< 50), rendered as histogram + table. The
  per-pair action opens a side-by-side source-code dialog fed by the
  `.../sources/[userId]/[problemId]` GET endpoint.
- GIVEN `report === null` (never triggered),
  WHEN the tab renders,
  THEN a "Run plagiarism check" CTA is shown.
- GIVEN `report.status` is `pending` or `running`,
  WHEN the tab renders,
  THEN a spinner + status label shows; polling cadence is controlled
  client-side.

## Edge Cases & Failure Modes

- **Native addon load failure**: Dolos's tree-sitter grammars are
  prebuilt N-API addons. If the worker image ships without a matching
  prebuild (libc or arch drift), `new Dolos({ language })` throws at
  construction; the activity's catch block marks the report `failed`,
  Temporal retries up to 3 times, then gives up. Operator fix: rebuild
  the worker image for the deploy target.
- **No fallback backend**: parser regression or Dolos failure is an
  operational failure. The activity must fail the report instead of
  silently skipping affected groups or trying an unverified secondary
  engine.
- **Single Dolos instance per group**: each `(problemId, language)`
  group gets a fresh `Dolos` instance; parser state is not shared
  across groups. A parser failure still fails the report.
- **Re-trigger mid-flight**: `createPlagiarismReport` wipes prior
  results before the new workflow starts; no merging with a prior run.
- **Assessment deleted while workflow running**: parent row cascade
  wipes everything; the activity's next Prisma write misses, the
  workflow fails with an unrecoverable error, and there is nothing left
  in the UI to show.
- **Zero accepted submissions in the target**:
  `listSubmissionsForCheck` returns `[]`, the activity iterates no
  groups, persists `{ pairs: [] }` with `status = completed`. UI shows
  "no similarity found".
- **Source-code lookup for a deleted user**:
  `getPlagiarismSourceCode` returns `null`; UI falls back to a "source
  unavailable" placeholder.
- **POST to `/api/plagiarism/[contestId]?type=contest`**: resolves
  through the contest branch. Permission falls back to platform-role
  checks (admin or platform teacher) since contests have no course
  membership.
- **Legacy MOSS-era rows**: reports that completed before the Dolos
  migration still carry the old pair shape (`similarity1`,
  `similarity2`, `linesMatched`, `mossUrl`). The UI must either
  tolerate the old shape or require staff to re-trigger; re-triggering
  overwrites with the new shape.

## Implementation References

### Domain

- `packages/domain/src/plagiarism/index.ts` — exports
  `getPlagiarismTarget`, `createPlagiarismReport`,
  `listSubmissionsForCheck`, `findPlagiarismReport`,
  `updateReportStatus`, `saveResults`, `markReportFailed`,
  `getPlagiarismSourceCode`, `listAssignmentPlagiarismReports`,
  `getAssignmentProblemMap`.
- `packages/domain/src/plagiarism/flags.ts` — `buildPairKey`,
  `flagPair`, `unflagPair`, `listFlagsForContext`. Pair-key shape:
  `[userA, userB].sort()` joined by `|` then `|problemId`. Unique on
  `(contextType, contextId, pairKey)`.
- `packages/domain/src/plagiarism/types.ts` — `SimilarityPair` (Dolos
  shape: `similarity`, `longest`, `overlap`).
- `packages/domain/src/shared/permissions.ts` —
  `resolveEffectiveCourseRole`, `canManageCourse`.

### Schema

- `packages/db/prisma/schema/ops.prisma` — `PlagiarismReportStatus`
  enum.
- `packages/db/prisma/schema/course.prisma` —
  `Assessment.plagiarism*` columns.
- `packages/db/prisma/schema/contest.prisma` — `Exam.plagiarism*` plus
  `Contest.plagiarism*` columns (both wired through the UI now).
- `packages/db/src/repositories/plagiarism.ts` — per-target
  `findBy*` / `upsertFor*` / `clearFor*` methods.
- `packages/db/src/repositories/plagiarism-pair-flag.ts` — `upsert`,
  `findById`, `delete`, `listForContext` for `PlagiarismPairFlag`.
- `packages/db/prisma/schema/plagiarism.prisma` — `PlagiarismContext`
  enum + `PlagiarismPairFlag` model with FK to `User.flaggedBy` and
  unique `(contextType, contextId, pairKey)`.
- Migration `20260420000000_rename_plagiarism_report_url` renamed the
  legacy `plagiarismMossReportUrl` column to `plagiarismReportUrl` on
  `Assessment`, `Exam`, and `Contest`.
- Migration `20260430000000_add_plagiarism_pair_flag` introduces the
  pair-flag table.

### Temporal

- `apps/worker/src/workflows/plagiarism-check.ts` — workflow +
  `getPlagiarismStatusQuery`.
- `apps/worker/src/activities/plagiarism.ts` —
  `runPlagiarismCheck`, Dolos analyze loop, language grouping. Depends
  on `@dodona/dolos-lib` and `@dodona/dolos-core`.
- `apps/worker/src/workflows/activity-options.ts` —
  `PLAGIARISM_ACTIVITY` sets `startToCloseTimeout: "10m"`,
  `maximumAttempts: 3`.
- `packages/temporal/src/dispatch.ts` —
  `dispatchPlagiarismCheck` (workflow-id scheme).

### Routes / API

- `apps/web/src/routes/api/plagiarism/[assignmentId]/reports/+server.ts`
  — POST trigger (returns `202`) + GET latest report.
- `apps/web/src/routes/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]/+server.ts`
  — GET source code for a flagged pair.
- `apps/web/src/routes/api/plagiarism-flags/+server.ts` — POST flag a
  pair as false-positive.
- `apps/web/src/routes/api/plagiarism-flags/[id]/+server.ts` — DELETE
  unflag.
- `apps/web/src/routes/(app)/assignments/[assignmentId]/+page.server.ts`
  — loads report + flag list for staff via
  `findPlagiarismReport(...).catch(() => null)` and
  `listFlagsForContext("assessment", assignmentId)`.
- `apps/web/src/routes/(app)/plagiarism/pairs/[pairId]/+page.server.ts`
  — staff-only Monaco diff page that resolves the pair against any of
  the three parent context types (assessment, exam, contest).
- `apps/web/src/lib/components/.../AssignmentPlagiarismReport.svelte` —
  histogram + table UI, bucketed by similarity, with in-product
  side-by-side source dialog and "顯示已標記為誤判" toggle.

### Tests

- `tests/unit/domain/plagiarism-queries.test.ts` — covers
  `getPlagiarismTarget` (exam / assessment / legacy-contest
  remap / not-found paths) and `createPlagiarismReport` (pre-wipe
  contract + persistence-failure throw).
- `tests/unit/temporal/plagiarism-activity.test.ts` — real-Dolos
  integration test of `runPlagiarismCheck` with the domain layer
  mocked: status bookkeeping, empty-submission short-circuit,
  best-score dedup, per-language grouping, single-submission skip, and
  failure paths that call `markReportFailed` + rethrow, including
  unmapped language values.
- `tests/unit/domain/plagiarism-flags.test.ts` — pair-key sorting +
  validation; admin / teacher / TA / student / inactive permission for
  each context type; organizer / non-organizer for contest; missing
  exam → forbidden; repeated upsert dedup; unflag NotFound / admin /
  non-staff / teacher branches; list delegation.
- `tests/unit/domain/plagiarism-trigger-log.test.ts` — `priorPairCount`
  computed from prior summary; contextType mapping
  (assessment / contest / exam); ordering (log written before
  overwrite); audit row persists even if `writePlagiarismFields` fails.
- `tests/integration/api/plagiarism.test.ts` — route-level permission
  gate for trigger / view / source fetch / flag / unflag against real
  DB (22 cases across student / other-course teacher / same-course TA /
  admin / contest organizer / non-organizer).
