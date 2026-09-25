# Feature: Contests

Acceptance spec for standalone contests (`Contest`, routes `/contests/[contestId]/...`). Contests have no course binding and no proctoring (no session, page lock or IP rules; those are exam-only, ASM-01). The scoreboard is the core feature, in ICPC (`problem_count`), weighted ICPC (`weighted_count`) or IOI (`point_sum`) scoring, with a freeze window.

## Key code

- `packages/application/src/contest/mutations.ts` — `createContestRecord`, `updateContestRecord`, `publishContest`, `deleteContestDraft`, `joinContest`, `joinContestByCode`, `ensureContestParticipation`, `checkSubmitCooldown`, lifecycle steps `activateContest`, `freezeContestBoard`, `finalizeContest`
- `packages/application/src/contest/queries.ts` — `getContestDetail`, `getContestWorkspaceData`, `canAccessContest`, `findViewerContestParticipation`, `unfreezeContest`
- `packages/application/src/contest/scoring.ts` — `updateContestScores`, `getScoreboard`, `getScoreboardChart`
- `packages/application/src/scoring/` — pure builders `buildScoreboard`, `buildScoreboardChartSeries`, `computeProblemCountPenalty`
- `packages/application/src/contest/permissions.ts` — `canManageContest`, `canViewLiveContestScoreboard`
- `packages/application/src/contest/upsolve.ts`, `packages/application/src/virtual-contest/` — post-contest views
- `packages/core/src/schemas/contest.ts`; `packages/db/prisma/schema/contest.prisma` (`Contest`, `ContestProblem`, `Participation`)
- Worker: `apps/worker/src/workflows/contest-lifecycle.ts`
- Routes: `apps/web/src/routes/(app)/contests/` (list, `joinByCode`), `contests/new/`, `contests/[contestId]/` (detail, `joinContest`, manager tabs), `[contestId]/scoreboard/`, `[contestId]/problems/[problemId]/`, `[contestId]/upsolve/`, `[contestId]/virtual/`
- Tests: `tests/unit/application/contest-permissions.test.ts`, `tests/unit/application/scoring/`, `tests/unit/application/proctoring-gate.test.ts`

## Model

- `visibility` is `draft | published`; there is no archive state. "Ended" is `endsAt < now`. `createContestRecord` inserts contests as `published`; `publishContest`/`deleteContestDraft` handle `draft` rows.
- A contest is public when `inviteCode` is null and private (invite-only) otherwise. The create form requires an invite code for private contests; none is generated.
- Settings: time window, `scoringMode`, `scoreboardMode` (`hidden | live | frozen`), `frozenAt`, `submitCooldownSec` (0–3600), `penaltyMinutesPerWrong` (0–1440, default 20), `allowedLanguages`, 1–32 problems.
- Participants are `Participation` rows with `type = contest` and status `registered` (joined) or `active` (submitted) (DAT-04).
- Management (edit, publish, delete, unfreeze, live board, plagiarism) is creator-or-admin via `canManageContest` (ASM-06). Only platform teachers and admins can create contests.
- Publishing or creating a published contest ensures the contest lifecycle workflow (activate at start, freeze at `frozenAt` in `frozen` mode, finalize at end). Changing start, end, `frozenAt` or `scoreboardMode` on a published contest replaces it.

Out of scope: proctoring, course membership gating, score overrides and feedback (ASM-17), a contest lifecycle audit log.

## Acceptance criteria

### Create and problems

- Non-teacher, non-admin actors get `ForbiddenError("Only teachers and admins can create contests.")`. An existing `id` fails with `ConflictError(\`Contest id already exists: ${id}\`)`.
- An actor-owned problem is attached directly. Another author's published public problem becomes an independent actor-owned private fork (PRB-10). Another author's private problem, the actor's unpublished private problem, or any later failure rolls back the contest and forks together.
- Every attached `multi_file` problem must have an editable `main.<ext>` for each allowed language, else `ValidationError`.
- `ContestProblem.points` is the submitted per-problem weight in `weighted_count` mode and the problem's raw total score otherwise.
- The problem list is replaced only while the contest is a draft or has not started; later `problems` payloads are ignored.

### Publish and delete

- `publishContest` requires a draft (`"Only draft contests can be published."`), ≥1 problem (`"Add at least one problem before publishing."`), ≥1 language (`"Select at least one allowed language before publishing."`), `startsAt < endsAt` and `endsAt > now` (`"End time must be in the future."`).
- `deleteContestDraft` deletes only drafts (`"Only draft contests can be deleted."`) and cancels lifecycle work.

### Update

- Non-owner, non-admin: `ForbiddenError("You do not have permission to edit this contest.")`.
- The effective window must keep `endsAt > startsAt`.

### Visibility and detail

- A draft contest is `NotFoundError` for non-managers; managers can open it.
- A private contest is `NotFoundError` for non-managers without a participation row (ASM-07).
- Before `startsAt`, non-managers get `problemsHidden: true` and `problems: null`; managers always see problems. The scoreboard page redirects non-managers to the detail page before start.
- `scoreboardMode: hidden` returns `entries: []` to non-managers.

### Joining

- Public contest: `?/joinContest` → `joinContest` upserts a `registered` participation before or during the contest. A contest with an invite code rejects it (`"This contest requires an invite code to join."`); at or after `endsAt`, `"Contest has ended."`.
- Private contest: `joinByCode` with a matching published contest's code registers the user and redirects to `/contests/[contestId]`. An empty code fails 400 (`contestsList_codeErrorEmpty`); an unknown code fails 404 (`contestsList_codeErrorInvalid`).
- The detail CTA is "Join contest" for non-managers who have not joined an upcoming or running contest, and "Enter contest" otherwise; `hasJoined` is any participation row.

### Participation and submitting

- `ensureContestParticipation` rejects before `startsAt` (`"Contest has not started yet."`) and at or after `endsAt` (`"Contest has ended."`). A non-manager without a participation row gets `"You must join the contest before submitting."`; managers and admins are exempt and auto-joined.
- On submit the participation is upserted to `active` with a composite-key upsert, so concurrent first submits converge on one row.
- The contest problem route redirects non-managers without participation, and non-managers before start, to `/contests/[id]`; after `endsAt` it redirects to `/problems/[problemId]`.
- `checkSubmitCooldown` enforces `submitCooldownSec` per user and problem under an advisory lock.

### Scoring

- Scores are recomputed after judging (`updateContestScores`) and are eventually consistent. Only submissions with `createdAt <= endsAt` count.
- `problem_count`: a problem is solved on its first `accepted` submission. Penalty for a solved problem = seconds from `startsAt` to first AC + wrong attempts before it × `penaltyMinutesPerWrong` × 60. Pending, `compile_error` and `system_error` submissions are never penalized (ASM-08). Score = solved count.
- `weighted_count`: as `problem_count`, but each solve is worth its `ContestProblem.points`.
- `point_sum`: per-problem best score across non-sample submissions; total = sum. `subtaskScores` stores `{ problemId: bestScore }`.
- Ranking sorts by total score descending, then total penalty ascending; equal pairs share a rank. First solves are flagged per problem.
- Contests never read score overrides. Results → Grades is read-only; any override request with a contest context fails schema validation (400) before permission checks.

### Scoreboard freeze

- The board is built from PostgreSQL on read and cached in Redis for 10 s per contest and variant (`live` or `public`), with a short build lock (DAT-11).
- Non-managers get the frozen view when `scoreboardMode === "frozen"`, or when `frozenBoard` is true and `now > frozenAt`. Submissions after `frozenAt` are hidden and marked pending. In `frozen` mode with no `frozenAt`, the cutoff is the read time.
- `freezeContestBoard` (lifecycle, `frozen` mode) sets `frozenBoard = true`; `finalizeContest` at `endsAt` sets it false. Visibility stays `published`.
- Managers always get the live view (`canSeeLive`), regardless of freeze or `hidden`.
- Unfreeze (organizer or admin) clears `frozenAt`.

### Scoreboard chart

- `getScoreboardChart(contestId, topN)` returns monotonic `{ time, score }` series from `startsAt` for the top-N entries of the same view, applying the same freeze cutoff. No entries → `series: []`.
- In `point_sum` mode every improvement in a problem's best score counts, including partial scores; the final point matches the scoreboard.

### Clarifications

Shared with assignments and exams; see [Exams — Clarifications](exams.md#clarifications).

### Audit timeline

- Managers see a read-only, newest-first list of `SubmissionRejudgeLog` rows for the contest's submissions. Contests have no lifecycle or override audit source.

### Plagiarism

- Managers get a plagiarism sub-tab reusing `AssignmentPlagiarismReport` with `diffContext = { type: "contest", id }`. See [Plagiarism](plagiarism.md).

### After the contest

- Upsolve (`/contests/[id]/upsolve`) appears only after `endsAt`: a read-only list of contest problems with the viewer's status (solved / attempted / untouched) linking to `/problems/[id]` (ASM-09).
- Virtual contests start only for ended contests, run for the original duration as `Participation` rows with `type = virtual`, and show a private board with the original final standings as ghost rows.
- Practice after close: a user with a participation row (even without submissions) can open attached problems at `/problems/[id]` via `assertProblemViewAccess`, and context-less submissions count as practice only. Users who never joined fall back to ordinary problem visibility (PRB-20).
