# Feature: Contests

Acceptance spec for standalone contests (`Contest` /
`/contests/[contestId]/...`). Contests are public or invite-only CP events
with NO course binding and NO proctoring — no page lock, no IP whitelist,
no IP binding, no session gate. The scoreboard is the central feature,
offered in ICPC (`problem_count`) or IOI (`point_sum`) flavors with
freeze/unfreeze for the final reveal.

## User Stories

- As a **platform admin** or **teacher**, I want to create a standalone
  contest with a title, summary, time window, scoring mode, scoreboard
  mode, and optional invite code, so that CP training / public events can
  live outside any specific course.
- As a **contest creator**, I want per-contest `scoringMode: problem_count`
  (ICPC) or `point_sum` (IOI) to drive how submissions roll up to the
  scoreboard, so that one platform covers both styles.
- As a **contest creator**, I want `scoreboardMode: hidden | live | frozen`
  so that I control whether participants see live ranks, no ranks, or a
  frozen snapshot.
- As a **contest creator**, I want a per-problem `submitCooldownSec` so that
  participants can't spam the judge.
- As a **participant**, I want to join a private contest via the invite
  code flow and have my participation created on first submission, so that
  I don't need to pre-register.
- As a **participant**, I want the contest detail page to hide the problem
  list until `startsAt`, so that early joiners can't read problems.
- As a **participant**, I want the scoreboard to stay frozen at the
  configured `frozenAt` moment (for the ICPC reveal drama), and unfreeze
  only when the creator signals it (or when `finalizeContest` runs at
  `endsAt`).
- As a **participant**, I want ended contests to leak their problems into
  practice mode, so that I can keep learning after the bell.

## Scope

### In scope

- `Contest` creation — standalone (no `courseId`), always `published` on
  create, `inviteCode` auto-generated when not supplied. Visibility is
  `draft | published` only — there is no `archived` enum value.
- `Contest` partial update (title/summary/timing/scoring/scoreboard mode/
  languages/cooldown/problem list).
- ICPC scoring (`scoring.computeProblemCountPenalty`): solved count +
  penalty seconds = `(firstAC - startsAt) + 20*min * wrongBefore`.
- IOI scoring: sum of best scores across attached problems.
- Participation auto-created on first submission
  (`ensureContestParticipation`).
- Submit cooldown enforcement (`checkSubmitCooldown`).
- Scoreboard build/read (computed live from PostgreSQL — `contest.participations`
  - submissions — on every fetch; no Redis zset backing).
- Scoreboard freeze/unfreeze: `Contest.frozenBoard` / `frozenAt` columns;
  `getScoreboard` builds with `frozenAt` as the cutoff (filtering out
  submissions after the freeze point) when `frozenAt < now` or mode ===
  `frozen`; unfreeze clears `frozenBoard`.
- Scoreboard chart series (top-N + time-series by user).
- Invite-code join flow (`joinByCode` action; redirects to
  `/contests/[id]` — participation is still lazy).
- Visibility gating: `getContestDetail` throws `NotFoundError` for any
  non-`published` contest — including for the creator/admin (there is no
  manager-only draft preview). In practice the draft state is
  unreachable via creation anyway: `createContestRecord` hardcodes
  `visibility: "published"`.
- Practice-after-close via `assertProblemViewAccess` historical-
  participant clause.
- Per-contest `allowedLanguages` with workspace-file invariant (every
  attached problem must ship editable `main.<ext>` for every language).
- Post-close score-override drawer on the submissions matrix —
  writes gated post-close (`endsAt < now`), admin bypass. Contests
  do NOT support per-cell student feedback; the grading drawer omits
  the feedback section in contest context (an explicit non-goal:
  contests are public CP events, not classroom homework).
- Audit sub-tab — staff-only merged feed of score override + rejudge
  events (`listAuditTimelineForContext({ type: "contest", id })`).
  Contests have no lifecycle audit log.

### Out of scope

- **Proctoring.** The `Contest` model has no proctoring fields
  (`ipWhitelistEnabled`, `ipBindingEnabled`, page lock, etc.). Phase 3 of
  the CUID unification briefly added them, but commit `fa742c7` removed
  them again — contests are public CP events, so proctoring controls
  live only on `Exam`. See `docs/specs/proctoring.md`.
- Course membership gating — anyone with the invite code (or on a public
  contest) can participate.
- Session management (`ActiveExamSession` lives on `Exam` only).
- Archive workflow — contests have no `archived` visibility state.
  "Ended" is purely time-derived from `endsAt < now`; the row stays
  `published` forever after that.

## Acceptance Criteria

### Create

- GIVEN a logged-in actor, WHEN `createContestRecord` is called with a
  fresh `id`, THEN the row is inserted with `visibility: 'published'`
  and `inviteCode` defaulted to `crypto.randomBytes(4).toString('hex')`
  when not supplied.
- GIVEN an `id` collision, WHEN create runs, THEN
  `ConflictError(\`Contest id already exists: ${id}\`)`.
- WHEN `problemIds` is empty AT CREATE, THEN `resolveAndAttachContestProblems`
  short-circuits (contests must pass ≥1 problemId at create per zod
  `.min(1)`; this is the schema-level guard, not domain-level).
- WHEN any attached problem lacks an editable `main.<ext>` for any
  `allowedLanguage`, THEN `ValidationError(...missing editable main.<ext>...)`.

### Update

- GIVEN a non-owner non-admin actor, WHEN `updateContestRecord` runs,
  THEN `ForbiddenError("You do not have permission to edit this contest.")`.
- WHEN `problemIds` is included in the payload, THEN existing
  `ContestProblem` rows are wiped and re-created in order with
  `points = 100` (no per-problem point override at update time).

### Visibility & detail

- GIVEN a non-`published` (e.g. `draft`) contest, WHEN ANY viewer hits
  `getContestDetail` (manager or not), THEN `NotFoundError` — there is
  no manager draft-preview path.
- GIVEN a `published` contest with `now < startsAt`, WHEN a non-manager
  viewer calls `getContestDetail`, THEN `problemsHidden: true` and
  `problems: null` in the response.
- GIVEN a manager viewer (creator or platform admin), THEN `problemsHidden:
false` regardless of time window, and the problem list is returned.
- GIVEN `scoreboardMode: 'hidden'` and a non-privileged viewer on
  `getScoreboard`, THEN `entries: []` (no leaderboard leak).

### Participation

- GIVEN a `published` contest with `now >= startsAt && now <= endsAt`,
  WHEN a user submits to a contest problem, THEN
  `ensureContestParticipation` upserts a row with `status: 'active'`.
- GIVEN `now < startsAt`, WHEN participation is attempted, THEN
  `ForbiddenError("Contest has not started yet.")`.
- GIVEN `now > endsAt`, WHEN participation is attempted, THEN
  `ForbiddenError("Contest has ended.")` — practice mode must be
  entered via `/problems/[id]` (no contest context).

### Invite code join

- GIVEN a valid invite code for a `published` contest, WHEN the user POSTs
  `joinByCode`, THEN the loader redirects to `/contests/[contestId]`.
  Participation is NOT created at join time — only on first submit.
- GIVEN an invite code that doesn't match any `published` contest,
  THEN `fail(404, { codeError: m.contestsList_codeErrorInvalid() })`.
- GIVEN an empty code, THEN
  `fail(400, { codeError: m.contestsList_codeErrorEmpty() })`.

### Scoring — ICPC (problem_count)

- WHEN `updateContestScores` runs for a participation with `scoringMode:
'problem_count'`, THEN each attached problem is graded via
  `computeProblemCountPenalty`:
  - Solved iff any submission has `status === 'accepted'`.
  - Penalty seconds for a solved problem =
    `(firstAC.createdAt - contest.startsAt) / 1000 + 20 * 60 *
countOfWrongsBefore`.
- Final `score = solvedCount`; `penaltySeconds = sum over solved
problems`; `buildScoreboard` ranks by a packed score = `solvedCount * 1e9 - totalPenalty` so
  lower penalty ranks higher within the same solve count.

### Scoring — IOI (point_sum)

- WHEN `updateContestScores` runs for `scoringMode: 'point_sum'`, THEN
  per-problem best score is taken across all non-sample submissions;
  total = sum of bests.
- `subtaskScores` is stored as `{ problemId → bestScore }`.

### Scoreboard freeze / unfreeze

- WHEN `freezeContestBoard(contestId)` runs, THEN `Contest.frozenBoard`
  is set to `true` and `frozenAt` is stamped. There is no snapshot key —
  the public board is derived at read time by filtering submissions to
  `createdAt <= frozenAt`.
- WHEN a submission is judged DURING a freeze, THEN it is persisted as
  normal, but `getScoreboard` excludes it from the public view (its
  `createdAt > frozenAt`) — the board stays frozen at the cutoff until
  unfreeze.
- WHEN `finalizeContest(contestId)` runs (via the contest lifecycle
  workflow at `endsAt`), THEN `frozenBoard = false`. Visibility stays
  `published` — there is no auto-archive flip anymore; "ended" is
  derived from `endsAt < now`.
- GIVEN `scoreboardMode === 'frozen'` OR (`frozenBoard && frozenAt <
now`) and the viewer is not privileged, THEN `getScoreboard` returns
  the frozen view (`isFrozen: true`).
- GIVEN `options.canSeeLive: true` (set server-side for privileged
  viewers — admin or contest organizer), THEN the live view is returned
  regardless of freeze or `hidden` mode.

### Scoreboard chart

- `getScoreboardChart(contestId, topN)` returns a time-series for the
  top-N participants from the (current-view) scoreboard; series are
  monotonic-increasing points `{ time, score }` starting from
  `contest.startsAt`.
- GIVEN no participations, THEN `series: []`.

### Permissions

- Non-owner / non-admin actors cannot update or finalize.
- Platform admins are implicit managers (`canManageContest` checks
  `platformRole === 'admin'` OR `createdByUserId === userId`).

### Grading — post-close drawer

- GIVEN a contest with `endsAt > now`, WHEN a manager opens the
  submissions matrix, THEN the grading drawer entry button is hidden
  and a "grading available after close" note is shown in its place.
- GIVEN a contest with `endsAt < now`, WHEN a manager opens a matrix
  cell, THEN the grading drawer shows ONLY the score-override
  section (the feedback section is omitted for contest contexts).
- GIVEN a non-admin manager actor with `now < endsAt`, WHEN
  `createOverride` / `updateOverride` / `deleteOverride` is called
  against the contest, THEN `ConflictError("This context is still open;
grading is only available after it closes.")` (shared post-close gate
  via `assertContextClosed`). `platformRole === "admin"` bypasses.

### Audit timeline

- GIVEN a staff viewer (contest creator or platform admin), WHEN
  they open the Audit sub-tab on the contest manage page, THEN
  `listAuditTimelineForContext({ type: "contest", id })` returns a
  reverse-chronological merge of `ScoreOverrideAuditLog` (override
  changes) + `SubmissionRejudgeLog` (rejudges scoped to the
  contest's submissions). No lifecycle audit-log source exists for
  contests.
- The view is read-only.

### Practice-after-close

- GIVEN an ended contest (`endsAt < now`, `visibility = 'published'`)
  that the user has a `ContestParticipation` row on,
  WHEN they visit `/problems/[id]` for an attached problem,
  THEN `assertProblemViewAccess` allows the view (historical-participant
  gate).
- WHEN they POST to `/api/submissions` without contest context, THEN
  the submission is accepted as practice (no scoreboard write, no
  participation update).
- GIVEN an ended contest the user NEVER submitted to (no
  `ContestParticipation` row — e.g. a public contest they only
  browsed), WHEN they visit `/problems/[id]`, THEN the historical-
  participant clause does NOT fire; access falls back to the ordinary
  problem-visibility rules. Practice-after-close is a participant
  perk, not a public post-contest unlock.

## Edge Cases & Failure Modes

- **Concurrent first-submit.** `ensureContestParticipation` uses a
  composite-key upsert, so two near-simultaneous first submissions
  converge to one `ContestParticipation` row.
- **`inviteCode` unique collision on create.** The 4-byte random
  fallback has ~4 billion keyspace; a clash raises a Prisma P2002 which
  propagates as an internal error. Mitigation: callers should supply a
  deterministic code for high-volume events.
- **Packed score with negative values.** ICPC packs the ranking score as
  `solvedCount \* 1e9 - penalty`. For `solvedCount = 0`, the packed score
  is `0 - penalty`, which is never negative in practice because
  `penalty > 0`only after AC — but a contest could have`solvedCount = 0, penalty = 0`entries
  by design. Verified safe in`contest-permissions.test.ts`.
- **Freeze then finalize.** `finalizeContest` clears `frozenBoard`. The
  contest stays `visibility = 'published'` — the "ended" presentation is
  derived client-side from `endsAt < now`. An already-rendered client
  view stays stale until next load.
- **Deleted problem referenced by a contest.** `ContestProblem.problemId`
  has `onDelete: Cascade` on the problem side — a rare admin wipe will
  cascade; live contests shouldn't hit this in practice because
  `Problem` deletion is admin-gated.
- **Participation stat shows `score = 0` but has AC submissions.** Means
  `updateContestScores` hasn't run yet for that participation; scoring
  is post-judge and is eventually consistent.

## Implementation References

### Domain

- `packages/domain/src/contest/mutations.ts` —
  `createContestRecord`, `updateContestRecord`,
  `ensureContestParticipation`, `checkSubmitCooldown`,
  `activateContest`, `freezeContestBoard`, `finalizeContest`,
  `resolveAndAttachContestProblems`.
- `packages/domain/src/contest/queries.ts` —
  `listPublicContests`, `listContestsForUser`,
  `getContestDetail`, `getContestWorkspaceData`,
  `findContestByInviteCode`, `getContestContext`,
  `unfreezeContest`.
- `packages/domain/src/contest/scoring.ts` —
  `updateContestScores`, `getScoreboard`, `getScoreboardChart`.
- `packages/domain/src/contest/permissions.ts` — `canManageContest`.
- `packages/domain/src/scoring/` — pure builders:
  `buildScoreboard`, `buildScoreboardChartSeries`,
  `computeProblemCountPenalty`.
- `packages/domain/src/proctoring/gate.ts` — `checkContestGate`
  (existence + visibility + time window; no IP).
- `packages/domain/src/score-override/permissions.ts` —
  `assertCanSetScoreOverride` (role + post-close gate),
  `assertCanViewScoreOverrides` (role-only).
- `packages/domain/src/shared/context-window.ts` — `isContextClosed`,
  `assertContextClosed` (shared post-close gate across assignment +
  exam + contest).
- `packages/domain/src/audit/queries.ts` —
  `listAuditTimelineForContext`.

### Schema

- `packages/core/src/schemas/contest.ts` — `contestCreateSchema`,
  `contestUpdateSchema`, `contestSessionSchema`.
- `packages/db/prisma/schema/contest.prisma` — `Contest`,
  `ContestProblem`, `ContestParticipation`, enum `ContestVisibility`,
  `ContestScoringMode`, `ContestParticipationStatus`, `ScoreboardMode`.

### Scoreboard computation

- The scoreboard is computed live from PostgreSQL on every fetch —
  `packages/domain/src/contest/scoring.ts` `getScoreboard` reads
  `contest.participations` + submissions and calls
  `packages/domain/src/scoring/` `buildScoreboard`. There is no Redis
  zset, no `ZADD`/`ZRANGE`, and no live/frozen snapshot keys. Freeze is a
  `Contest.frozenBoard` / `frozenAt` column pair; `buildScoreboard`
  applies `frozenAt` as a submission cutoff to produce the frozen view.

### Routes / API

- `apps/web/src/routes/(app)/contests/+page.server.ts` — list +
  `joinByCode` action.
- `apps/web/src/routes/(app)/contests/new/+page.server.ts` — create form.
- `apps/web/src/routes/(app)/contests/[contestId]/+page.server.ts`
  (detail). The detail page exposes a `plagiarism` sub-tab for managers
  that reuses `AssignmentPlagiarismReport` with
  `diffContext = { type: "contest", id }`.
- `apps/web/src/routes/(app)/contests/[contestId]/scoreboard/+page.server.ts`
  — scoreboard view + chart (`canUnfreeze` for admins/teachers).
- `apps/web/src/routes/(app)/contests/[contestId]/problems/[problemId]/+page.server.ts`
  — in-contest workspace.

### Tests

- `tests/unit/domain/contest-permissions.test.ts` — canManageContest +
  visibility gating.
- `tests/unit/domain/scoring/` — ICPC/IOI scoreboard builder + chart
  series.
- `tests/unit/domain/proctoring-gate.test.ts` — contest gate (no IP).
