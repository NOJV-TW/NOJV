# Submission Display Unification + Workspace Context Rules — Design

Date: 2026-05-27
Branch: `feat/submission-unification`

## Problem

Submission display is fragmented, the per-case result schema is split in two,
and a few context rules are wrong:

1. **Two divergent per-case result shapes.** `testcaseResultItemSchema` (flat
   `caseResults`: `{ index, passed, stdout, stderr?, timeMs, memoryKb? }`) and
   `subtaskCaseResultSchema` (subtask `cases`: `{ ordinal, runtimeMs, testcaseId,
   verdict, memoryKb? }`). Both are projections of the same sandbox output built
   in `scoring.ts` `mapResult()`, but with different field names and outcome
   representations (`passed` boolean vs `verdict` short code). The flat one is
   lossy (no verdict string).
2. **Three conflicting verdict colour systems.** `verdict-style.ts` `verdictColor`
   (text-only; TLE/MLE = red, CE/RE = amber), `badge.svelte` `verdict-*`
   variants (TLE/MLE = warning, CE/RE = destructive), and a hard-coded map in
   `left-panel/SubtaskResults.svelte`. Same verdict renders differently per surface.
3. **No shared submission components.** Subtask/case rendering is re-implemented:
   the detail page has a non-expandable subtask summary; `SubtaskResults` is an
   expandable tree; case grids differ between detail page and editor run panel.
4. **Contest submission scoping bug.** `contests/[contestId]/problems/[problemId]/+page.server.ts:24`
   calls `listProblemSubmissions(userId, problemId)` with **no context filter**;
   the comment at `problem-solve.ts:134-137` claims submissions are "always
   scoped to the shell's context" but `listProblemSubmissions` only supports an
   `assignmentFilter`. A contest workspace lists practice + assignment + contest
   attempts mixed. Exam is correctly scoped; contest is not.
5. **Editorial spoiler in active contest/exam.** `ProblemLeftPanel.svelte:128-136`
   always renders the Editorials tab; content is gated only by
   `hasAc = canViewEditorials || submissions.some(verdict === "accepted")`. A
   student who ACs **mid-event** unlocks community editorials
   (`/api/problems/[id]/editorials`, which `isAllowedPathForExam` permits) —
   an integrity hole.
6. **Inconsistent ended-event routing.** Ended contests/exams `redirect` to
   `/problems/[id]` (practice); ended **assignments** render in-place with an
   `endedKind="assignment"` notice.
7. **`/submissions` list under-built.** Rows link to `/problems/[id]` (not the
   detail page), show no memory, no context, no filtering.

## Decisions (confirmed with user)

1. **Keep the four route trees.** No collapse to a single `/problems/[id]` — a
   problem can belong to multiple contexts at once; the explicit path is the
   unambiguous intent that tags submissions to the right assignment/contest/exam,
   and the exam-lock gate's security depends on the `/exams/[examId]/*` boundary.
2. **Keep `/submissions/[id]`.** Staff review surface (renders submitter identity
   via `viewerIsStaff`) + student self-view. Authz unchanged; active-exam escape
   already prevented in `hooks.server.ts` (off-exam page → `redirect(307)` + log).
3. **Keep + strengthen the `/submissions` list** as a personal cross-problem history.
4. **Verdict colour: one source, Badge semantics** — resource limits (TLE/MLE) =
   warning, errors (WA/RE/CE) = destructive, AC = success, pending = info.
5. **Editorials only when not in an active restricted event** — practice always;
   assignment/contest/exam hidden while active. Ended contests/exams already
   redirect to practice; **ended assignments will now redirect to
   `/problems/[id]?ended=assignment` too** (managers excepted). The
   historical-participant gate (`permissions.ts:85-90`) already admits past
   assignment participants to a private problem's practice view → no access loss.
6. **Practice submission tab = all-context personal history.** Every row shows a
   context tag (practice/assignment/contest/exam) in **all** contexts so the
   source is always explicit.
7. **Sibling problem switcher** (`ProblemSwitcherDrawer`) already exists for
   assignment/contest/exam — no work.
8. **Unify the per-case result schema** into one `caseResultSchema`. The system
   is **not yet in production**, so this is a clean cutover — **no backward-compat
   layer, no data migration**; the dev DB is re-seeded. Unify the per-case *type*
   only; the two *containers* (flat `caseResults` for sample/non-subtask, grouped
   `subtaskResults` for graded) stay because sample runs have no subtasks
   (container dedup is out of scope — over-engineering).

## Design

### Phase 0 — Unified per-case result schema (core)

Replace `testcaseResultItemSchema` + `subtaskCaseResultSchema` with one schema in
`packages/core/src/schemas/submission.ts`:

```ts
export const caseResultSchema = z.object({
  index: z.number().int().nonnegative(),     // position within its list
  verdict: z.string().max(16),               // sandbox short code; passed = verdict === "AC"
  timeMs: z.number().int().nonnegative(),
  memoryKb: z.number().int().nonnegative().optional(),
  stdout: z.string().max(MAX_CASE_STDOUT_BYTES).optional(), // flat/sample; omitted on graded subtask cases
  stderr: z.string().max(MAX_CASE_STDERR_BYTES).optional(),
  testcaseId: z.string().optional(),         // graded cases; absent for sample runs
});
```

- `submissionResultSchema.caseResults` and `subtaskResultItemSchema.cases` both
  become `z.array(caseResultSchema)`.
- Drops `passed` (→ derive from `verdict`), `ordinal` (→ `index`), `runtimeMs`
  (→ `timeMs`). One outcome representation (`verdict`), one timing field (`timeMs`).

Producer — `packages/domain/src/submission/scoring.ts`:
- `mapResult` flat `caseResults`: emit `verdict: t.verdict` (was `passed: t.verdict === "AC"`).
- `buildSubtaskResults` cases: `{ index, verdict, timeMs, testcaseId, memoryKb? }`
  (was `{ ordinal, runtimeMs, testcaseId, verdict }`). Update the local
  `SubtaskResultItem.cases` interface (`scoring.ts:6-13`) to match.

Read sites (5) — schema swap is transparent; just recompile + typecheck:
`virtual-contest/queries.ts:318`, `exam/problem-view.ts:110,212`,
`submission/queries.ts:87,220`.

Seed + fixtures: re-run `pnpm db:seed`; update `tests/unit/worker/sandbox-result-mapper.test.ts`,
`tests/unit/domain/build-subtask-results.test.ts`,
`tests/integration/submission-judge-flow.test.ts` to the new shape.

### Phase 1 — Verdict presentation single source of truth

- `apps/web/src/lib/utils/verdict-style.ts` (already drafted): `verdictBadgeVariant(v)`
  → Badge variant, `verdictTone(v)` → text-colour class; both normalize sandbox
  short codes + full enum. `verdictColor` removed.
- New `primitives/ui/VerdictBadge.svelte` — `{ verdict, size? }` → `<Badge>`.
- Migrate callers: `/submissions` list, `/submissions/[id]` (hero = `verdictTone`,
  rest pills), `SubmissionHistoryPanel`, dashboard recent submissions,
  `EditorBottomPanel` (verdict colour only — its run-result view pairs judged
  output with the student's *editable* `runCases` I/O, a different data model;
  stays bespoke). Update `tests/unit/web/verdict-colors.test.ts`.

### Phase 2 — Shared result components

- New `features/submission/SubtaskResultTree.svelte` — expandable tree
  (generalised from `left-panel/SubtaskResults.svelte`), case verdicts via the
  unified colour source. Takes `SubtaskResultItem[]`.
- New `features/submission/CaseResultGrid.svelte` — case pills, optional
  stdout/stderr expansion when `sampleOnly`. Takes `caseResultSchema[]`.
- Consumers: `SubmissionHistoryPanel` + `/submissions/[id]` use both; the detail
  page gains per-subtask case expansion. Delete `left-panel/SubtaskResults.svelte`.

### Phase 3 — Workspace context rules

- **Editorials gate:** add `editorialsEnabled?: boolean` threaded
  `ProblemSolveView → ProblemWorkspace / AdvancedModeWorkspace → ProblemLeftPanel`;
  render the Editorials tab only when set. Practice `true`; others omit.
- **Ended assignment → redirect:** in
  `assignments/[assignmentId]/problems/[problemId]/+page.server.ts`, replace the
  `isEnded` render path with
  `if (!isManager && now > closes) redirect(302, /problems/${problemId}?ended=assignment)`;
  drop the dead `isEnded`/`endedKind` wiring in that route. Managers still render.
- **Practice ended notice:** `problems/[problemId]/+page.svelte` — derive
  `endedKind` from `?ended=` for both `assignment` and `exam`.

### Phase 4 — Contest submission scoping fix

- `packages/db/src/repositories/submission.ts` `listByUserAndProblem`: add optional
  `contestId` filter.
- `packages/domain/src/submission/queries.ts` `listProblemSubmissions`: generalise
  the third param to `context?: { assignmentId; courseId } | { contestId }`.
- `contests/[contestId]/problems/[problemId]/+page.server.ts:24`: pass `{ contestId }`;
  delete the false "always scoped" comment.

### Phase 5 — `/submissions` list strengthening + discoverability

- `submission.ts` repo `listByUser`: add `memoryKb` + `examId/contestId/courseAssessmentId`.
- `queries.ts` `listUserSubmissions`: map `memoryKb` + derived `context` kind.
- `(app)/submissions/+page.svelte`: rows link to `/submissions/{id}`, `VerdictBadge`,
  memory, context-kind tag, client-side filter bar (verdict / language / title).
- Nav: add `{ href: "/submissions", icon: History }` to `Header.svelte` after Problems.
- i18n: context-kind + filter labels (en + zh-TW); recompile paraglide.

### Phase 6 — Per-entry context tag in the workspace submission panel

- Add the derived `context` kind to `ProblemSubmissionEntry`.
- `SubmissionHistoryPanel`: render a context tag per row in **all** contexts.

## Out of scope

- **Container dedup (U1).** Cases stay listed in both `caseResults` and
  `subtaskResults` for graded subtask submissions — only the per-case *type* is
  unified. Removing the double-storage is a separate optimisation, not worth the
  producer/consumer churn at this scale.
- `/api/submissions/[id]/*` active-exam context hardening (pre-existing proctoring
  gap, separate task).
- Route collapse; `getSubmissionDetail` authz changes (none needed).
- Removing the standalone `/problems/[problemId]/editorials` route (verify inbound
  links first — separate cleanup).
- Stripping stdout from graded (non-sample) flat `caseResults` (current behaviour kept).

## Tests

- Phase 0: `mapResult` / `buildSubtaskResults` emit the unified shape
  (`tests/unit/domain/build-subtask-results.test.ts`); sandbox-result-mapper +
  judge-flow fixtures updated; `submissionResultSchema.parse` round-trips.
- Phase 1: `verdictBadgeVariant` / `verdictTone` map every status (incl. short
  codes) to the canonical variant/tone.
- Phase 4: `listProblemSubmissions` contest filter excludes practice/assignment rows.
- Phase 5: `listUserSubmissions` shape (`memoryKb` + context kind).
- Phase 3: ended-assignment redirect (non-manager → 302; manager renders);
  editorials tab hidden in contest/exam, shown in practice.
- `pnpm typecheck && pnpm lint && pnpm test:unit`; integration for the scoping items.

## Build sequence

1. **Phase 0** — unified `caseResultSchema`: core → `scoring.ts` producer → 5
   read sites → re-seed → fixtures/tests. Land green before touching UI.
2. **Phase 1** — `verdictBadgeVariant`/`verdictTone` + `VerdictBadge`; migrate callers.
3. **Phase 2** — `SubtaskResultTree` + `CaseResultGrid`; wire detail + history panel.
4. **Phase 3** — `editorialsEnabled`; ended-assignment redirect; practice ended notice.
5. **Phase 4** — contest filter.
6. **Phase 5** — `/submissions` strengthening + nav + i18n + paraglide.
7. **Phase 6** — per-entry context tag.
8. `ci:verify` + integration for scoping.
