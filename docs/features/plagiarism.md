# Feature: Plagiarism Detection

Acceptance spec for staff-triggered Dolos similarity checks on assignments, exams and contests. Report state is stored inline on the parent row; a Temporal workflow runs Dolos in the worker with no network egress (ASM-23). Staff can mark pairs as false positives and every run leaves a trigger receipt (ASM-24).

## Key code

- `packages/application/src/plagiarism/queries.ts` — `getPlagiarismTarget`, `createPlagiarismReport`, `listSubmissionsForCheck`, `findPlagiarismReport`, `updateReportStatus`, `saveResults`, `markReportFailed`, `getPlagiarismSourceCode`, `listAssignmentPlagiarismReports`
- `packages/application/src/plagiarism/flags.ts` — `buildPairKey`, `flagPair`, `unflagPair`, `listFlagsForContext`
- `packages/application/src/plagiarism/types.ts` — `SimilarityPair`, `PlagiarismResults`
- `apps/worker/src/activities/plagiarism.ts` — `runPlagiarismCheck` (dedup, grouping, Dolos)
- `apps/worker/src/workflows/plagiarism-check.ts`; `apps/worker/src/workflows/activity-options.ts` (`PLAGIARISM_ACTIVITY`)
- `packages/temporal/src/dispatch.ts` — `dispatchPlagiarismCheck`
- `apps/web/src/lib/server/plagiarism-pair.ts` — `assertCanManagePlagiarism`, `loadPlagiarismPair`
- Routes: `apps/web/src/routes/api/plagiarism/[assignmentId]/reports/+server.ts`, `.../sources/[userId]/[problemId]/+server.ts`, `apps/web/src/routes/api/plagiarism-flags/+server.ts`, `plagiarism-flags/[id]/+server.ts`, `apps/web/src/routes/(app)/plagiarism/pairs/[pairId]/+page.server.ts`
- UI: `apps/web/src/lib/components/features/plagiarism/AssignmentPlagiarismReport.svelte` (assignment, exam and contest detail pages)
- Schema: `Assessment`/`Exam`/`Contest` columns `plagiarismStatus`, `plagiarismResults` (JSON), `plagiarismReportUrl`, `plagiarismTriggeredAt`, `plagiarismCompletedAt`, `plagiarismTriggeredById`; `packages/db/prisma/schema/plagiarism.prisma` (`PlagiarismPairFlag`, `PlagiarismTriggerLog`, `PlagiarismContext`); `PlagiarismReportStatus` in `ops.prisma`
- Tests: `tests/unit/application/plagiarism-queries.test.ts`, `plagiarism-flags.test.ts`, `plagiarism-trigger-log.test.ts`; `tests/unit/temporal/plagiarism-activity.test.ts`; `tests/integration/api/plagiarism.test.ts`

Out of scope: student-visible results, automatic penalties (use rejudge or score overrides), cross-activity or cross-language comparison, scheduled triggers, completion notifications (the UI polls).

## Acceptance criteria

### Permissions

- Assignment and exam targets: the actor's effective course role must be admin, course teacher or course TA (`canManageCourse`); platform teachers without membership are denied.
- Contest targets: platform admin or the contest creator.
- Denials: trigger `"Only staff can trigger plagiarism checks."`, report view `"Only staff can view plagiarism reports."`, source view `"Only staff can view plagiarism source code."`. Students never see reports, pairs or sources.

### Target resolution

- `?type=exam`, `?type=contest` or no type (assignment) select the parent. Unknown ids return 404 `"Exam not found."`, `"Contest not found."` or `"Assignment not found."`.
- Contest targets resolve with `courseId: ""`.

### Trigger and lifecycle

- `POST /api/plagiarism/[id]/reports` writes a `PlagiarismTriggerLog` row (who, when, `priorPairCount`) before overwriting, then sets `plagiarismStatus = pending`, clears results, report URL and completion time, records trigger time and user, dispatches the workflow, and returns 202 with a `Location` poll URL.
- Workflow id `plagiarism-${targetType}-${targetId}` on the platform task queue with `workflowIdConflictPolicy: TERMINATE_EXISTING`: re-triggering terminates an in-flight run and starts a fresh one.
- The activity sets `running`, then `completed` with `{ pairs }` and `plagiarismCompletedAt`, or `failed` on any error and rethrows. Activity options: `startToCloseTimeout: "10m"`, `maximumAttempts: 3`.
- `plagiarismReportUrl` is always null for Dolos runs.
- If the parent row is deleted mid-run, the next write fails and the workflow fails.

### Analysis

- Input: `accepted` submissions of the target; per `(userId, problemId)` only the highest-scoring one is kept. Before Dolos tokenization, a multi-file submission is concatenated in sorted path order, each file preceded by a separator line `// === <path> ===` (`# === <path> ===` for Python) (`boundaryMarkerFor`).
- Groups are `(problemId, language)`; each supported language (`c`, `cpp`, `go`, `java`, `javascript`, `python`, `rust`, `typescript`) uses its own tree-sitter parser and a fresh `Dolos` instance. Pairs never cross groups.
- An unknown language value fails the report (no skip, no fallback). A native addon load failure fails the report; fix by rebuilding the worker image for the target.
- Groups with fewer than two submissions are skipped. No accepted submissions → `completed` with `{ pairs: [] }`.
- Each pair: `problemId`, `userId1`, `userId2`, `similarity` (0–100, symmetric), `longest` and `overlap` (AST tokens).

### Retrieval

- `GET /api/plagiarism/[id]/reports` returns `{ reports: [summary] }`, or `{ reports: [] }` when never triggered.
- `GET /api/plagiarism/[id]/sources/[userId]/[problemId]` returns `{ files, submissionId }` with every file of the selected submission; both are null when no source exists. Missing path params return 400 `"Missing assignmentId, userId, or problemId."`.

### False-positive flags

- Staff flag a pair (`POST /api/plagiarism-flags`) and unflag it (`DELETE /api/plagiarism-flags/[id]`). The key is the two user IDs sorted and joined with `|`, then `|problemId`; flags are unique per `(contextType, contextId, pairKey)` and repeated flags upsert.
- A pair of the same user twice, or missing fields, is a `ValidationError`.

### UI

- Never triggered: a "Run plagiarism check" CTA. `pending`/`running`: spinner and status, polled client-side.
- `completed`: pairs bucketed High (≥ 70), Medium (50–69) and Low (< 50) as histogram and table; flagged pairs are hidden unless the "show flagged" toggle is on.
- Each pair opens a side-by-side source dialog and links to the Monaco diff page `/plagiarism/pairs/[pairId]`, which resolves the pair for assignment, exam or contest targets.
