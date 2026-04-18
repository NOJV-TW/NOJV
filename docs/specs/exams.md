# Feature: Course Exams

Acceptance spec for course-embedded exams (`Exam` /
`/exams/[examId]/...`). Exams are proctored in-class assessments: students
must start a session, are locked to the exam routes until release, and may
be IP-bound or IP-whitelisted. When the window ends, a Temporal workflow
auto-closes every active session; post-close review is blocked for
students by default (archived detail page is manager-only).

## User Stories

- As a **teacher** or **TA**, I want to configure an exam with start/end
  times, allowed languages, scoring mode (point sum or problem count),
  scoreboard mode (hidden/live/frozen), and per-problem points, so that a
  single exam row captures the whole assessment contract.
- As a **teacher** or **TA**, I want to toggle `pageLockEnabled`,
  `ipWhitelistEnabled` (+ CIDR list), `ipBindingEnabled`, and
  `ipViolationMode: block | notify`, so that the lab's network / seat
  assignment is the only place the exam can be taken.
- As a **student**, I want a clear "start exam" action that creates my
  session, pins my IP (when binding is on), and redirects me to the exam
  workspace, so that the proctoring contract is explicit and reversible
  only by the instructor or the auto-close workflow.
- As a **student**, I want mid-exam navigation to any non-exam page to
  auto-redirect me back and log a `visibility_lost` event, so that the
  page lock is enforced without silently failing.
- As a **teacher**, I want the scoreboard to freeze at an instructor-
  chosen moment (`setExamBoardFrozen`) and unfreeze on demand, so that the
  final reveal is controlled.
- As a **teacher**, I want a submissions matrix (students × problems,
  best score + attempts + AC/partial/zero cells) that recomputes on every
  load, so that I can spot-check performance without running SQL.
- As a **proctor / teacher on duty**, I want to release a stuck student's
  session manually (`releaseSessionAsInstructor`), so that an edge case
  like a crashed browser doesn't block them from a retry.

## Scope

### In scope

- `Exam` CRUD — create, partial update, publish, delete-draft, archive,
  unarchive. Parallel shape to `CourseAssessment`.
- Publish validation: ≥1 problem, ≥1 allowed language, `startsAt < endsAt`,
  `endsAt > now`.
- Session lifecycle (`ActiveExamSession`): `startSessionWithGate`,
  `heartbeat` + `heartbeatWithThrottle` (audit throttle 60s),
  `recordEvent` (`enter | leave | visibility_lost | release | auto_close
| heartbeat`), `endSession`, `releaseSessionAsInstructor`.
- Global mutual exclusion: a user can have at most one active session
  globally at any time (started on exam A blocks start on exam B).
- Auto-close Temporal workflow (`examAutoCloseWorkflow`) scheduled on
  publish + on create-as-published; calls `closeActiveSessionsForExam`.
- Page lock via `hooks.server.ts` — every non-exam route for a user with
  an active session redirects to `/exams/[examId]` and logs
  `visibility_lost` with the attempted path.
- IP gating via `checkIpLock` (whitelist + binding); empty whitelist with
  `ipWhitelistEnabled=true` means **deny all** (fail-closed).
- Violation modes: `block` rejects the submission / gate; `notify` logs
  an `IpViolationLog` row but allows the request.
- Scoreboard live/frozen via `@nojv/redis` `scoreboard` module
  (zset-backed, 90-day TTL refreshed on writes).
- Submissions matrix (`getExamSubmissionsMatrix`) — manager-only view.
- Post-close student review block: archived / ended exams hide the
  detail page from students (`getExamDetailPage` returns null for
  non-managers when `status === 'archived'`). Practice-after-close still
  allows accessing the problems via `/problems/[id]` (no context).
- `scoringMode: problem_count` (ICPC-style solved count + penalty) and
  `point_sum` (IOI-style weighted total).
- `scoreboardMode: hidden | live | frozen`.

### Out of scope

- Contest-style invite codes (exams rely on course membership).
- Late-submission UI flag in the matrix (explicit non-goal per
  practice-after-close design doc).
- Remote proctoring features (webcam, screen recording, browser
  lockdown) — out of scope by current product decision.

## Acceptance Criteria

### Create / publish

- GIVEN a course-teacher actor, WHEN `createExamRecord` is called with
  `status: 'published'`, THEN the exam is inserted, problems attached, and
  `dispatchExamAutoClose` fires after transaction commit.
- GIVEN a rolled-back transaction, WHEN create fails,
  THEN `dispatchExamAutoClose` is NOT called (post-commit dispatch).
- GIVEN a draft exam with 0 problems, WHEN `publishExam` is attempted,
  THEN `ValidationError("Add at least one problem before publishing.")`.
- GIVEN a draft exam with empty `allowedLanguages`, WHEN publish is
  attempted, THEN `ValidationError("Select at least one allowed language before publishing.")`.
- GIVEN `startsAt >= endsAt`, WHEN publish runs, THEN
  `ValidationError("Start time must be before end time.")`.
- GIVEN `endsAt <= now`, WHEN publish runs, THEN
  `ValidationError("End time must be in the future.")`.
- WHEN `publishExam` succeeds, THEN `dispatchExamAutoClose` is called
  post-commit with `endsAt.toISOString()`.

### Archive / unarchive / delete-draft

- GIVEN a `published` exam, WHEN `archiveExam` runs, THEN `status ->
archived` and the detail page becomes manager-only.
- GIVEN an `archived` exam, WHEN `unarchiveExam` runs, THEN `status ->
published`.
- GIVEN a non-draft exam, WHEN `deleteExamDraft` runs,
  THEN `ValidationError("Only draft exams can be deleted.")`.

### Session — startSessionWithGate

- GIVEN an exam in `published` status with `now >= startsAt -
START_GRACE_MS` (5 min) and `now < endsAt`, and the actor is an active
  course member, WHEN `startSessionWithGate` is called,
  THEN a new `ActiveExamSession` is created with `ipPin = input.ipPin`,
  an `enter` event is recorded, and the result includes `created: true`.
- GIVEN `now < startsAt - START_GRACE_MS`, WHEN start runs,
  THEN `HttpError("Exam has not started yet.", 410)`.
- GIVEN `now >= endsAt`, WHEN start runs,
  THEN `HttpError("Exam has ended.", 410)`.
- GIVEN the actor already has an active session on a DIFFERENT exam,
  WHEN start runs, THEN
  `ConflictError("You already have an active session on a different exam.")`.
- GIVEN the actor already has an active session on THIS exam,
  WHEN start runs, THEN the existing session is returned with
  `created: false` (idempotent).
- GIVEN the parent course is `archived: true`,
  WHEN start runs,
  THEN `ForbiddenError("This course is archived; new exam sessions are not allowed.")`.

### Session — heartbeat

- WHEN `heartbeatWithThrottle` is called and the last `heartbeat` event
  was >60s ago, THEN `lastHeartbeatAt` is bumped AND a new audit event is
  recorded (`recordedEvent: true`).
- WHEN the last event was <60s ago, THEN `lastHeartbeatAt` is still
  bumped BUT no audit event is inserted (`recordedEvent: false`).
- GIVEN the session has already ended, WHEN heartbeat is called,
  THEN `NotFoundError("No active exam session to heartbeat.")`.

### Session — page lock (hooks.server.ts)

- GIVEN a user with an active session on exam E, WHEN they request any
  path not matching `/api/`, `/signin`, `/signout`, or `/exams/E/...`,
  THEN `hooks.server.ts` records a `visibility_lost` event with
  `metadata.attemptedPath` and responds with `307` to `/exams/E`.
- WHEN `recordEvent` throws (DB failure), THEN hooks.server.ts logs a
  warning and still redirects — page-lock redirection is fail-safe.
- WHEN `getActiveExamContext` throws (DB failure), THEN hooks.server.ts
  fails OPEN (logs a warning, does not lock the user out of the site).

### Session — auto-close

- WHEN the exam's `endsAt` is reached, THEN the `examAutoCloseWorkflow`
  wakes, calls `autoCloseForExam`, and for every active session inserts
  an `auto_close` event + sets `endedAt = now`, `releaseReason = 'time_up'`.
- GIVEN re-running `autoCloseForExam` on the same exam, THEN it is
  idempotent (no-op when no active sessions remain).

### Session — instructor release

- GIVEN a course staff actor (owner or active teacher/TA of the course),
  WHEN `releaseSessionAsInstructor({ examId, targetUserId })` is called,
  THEN the target student's session `endedAt` is set, `releaseReason =
'released_by_instructor'`, and an event is recorded with
  `metadata = { reason, endedByUserId: actor.userId }`.
- GIVEN a non-staff actor, THEN
  `ForbiddenError("Only course staff can release exam sessions.")`.

### IP gating

- GIVEN `ipWhitelistEnabled = true` and `ipWhitelist` contains a CIDR
  matching the client IP, WHEN `checkIpLock` runs,
  THEN `{ allowed: true }`.
- GIVEN `ipWhitelistEnabled = true` and the list is EMPTY,
  WHEN `checkIpLock` runs with any client IP,
  THEN `{ allowed: false, violationType: 'whitelist' }` (fail-closed).
- GIVEN `ipBindingEnabled = true` and the participation has no `ipPin`,
  WHEN the first call lands, THEN `ipPin` is stamped to the current IP
  and allowed; subsequent calls compare against that pin.
- GIVEN `ipBindingEnabled = true` and the pinned IP differs from the
  client IP with `ipViolationMode: 'block'`,
  THEN `{ allowed: false, violationType: 'binding' }`.
- GIVEN `ipViolationMode: 'notify'`, THEN violations insert a row in
  `IpViolationLog` (via `logViolationInTx`) and return `{ allowed: true }`.
- See `docs/specs/proctoring.md` for the full proctoring spec.

### Scoreboard

- WHEN `setExamBoardFrozen(actor, examId, true)` is called by a manager,
  THEN `scoreboard.freezeScoreboard(examId)` snapshots the live zset into
  the frozen key and sets `Exam.frozenBoard = true`.
- WHEN `setExamBoardFrozen(..., false)` is called, THEN the frozen key
  is deleted (live key stays authoritative) and `frozenBoard = false`.
- GIVEN `setExamBoardFrozen` with a non-manager actor, THEN
  `ForbiddenError(...)`.

### Submissions matrix

- WHEN `getExamSubmissionsMatrix(examId)` is called, THEN `rows` lists
  each active-student member of the parent course once with cells per
  problem. Each cell carries `{ problemId, score, attempts, state }`.
- `state === 'ac'` iff `best >= problem.points`; `'partial'` iff
  `0 < best < problem.points`; `'zero'` iff `best === 0`; `'empty'` iff
  no submissions (`attempts === 0`).
- Only non-sample submissions (`sampleOnly: false`) count toward the
  matrix.

### Practice-after-close

- GIVEN an ended exam (`endsAt < now`, `status = 'published'`) that the
  student has a participation row on, WHEN they visit `/problems/[id]`
  for an attached problem (no context), THEN the page loads via the
  `assertProblemViewAccess` historical-participant gate.
- WHEN the same student POSTs to `/api/submissions` WITHOUT exam context
  on the same problem, THEN the submission is accepted as practice (no
  scoreboard write, no matrix contribution, no participation update).

### Post-close review block

- GIVEN a student on `/exams/[examId]` for an exam with `status =
'archived'`, WHEN `getExamDetailPage` is called with
  `isManager: false`, THEN it returns `null` and the loader 404s.
- The workaround for students is the practice-after-close route through
  `/problems/[id]` (no detail page needed).

## Edge Cases & Failure Modes

- **IP whitelist: `ipWhitelistEnabled=true` + empty list.** Fail-closed —
  deny every request. Regression-tested in `ip-utils.test.ts`.
- **Course archived mid-exam.** Existing active sessions are NOT torn
  down; the student can finish. New `startSession` calls are denied by
  `assertEnrolledInExamCourse`.
- **Concurrent start of the same exam.** Idempotent — the second call
  returns the existing session with `created: false`.
- **Auto-close workflow replayed after manual unarchive.** The workflow
  only runs once per publish dispatch; re-publishing an archived exam
  dispatches a fresh workflow.
- **Freeze then new submissions arrive.** Live key continues updating
  (ZADD is idempotent with TTL refresh); the frozen key is a snapshot.
  `getScoreboard` returns the frozen view until `unfreezeScoreboard` DELs
  the frozen key.
- **`recordEvent('visibility_lost')` fails.** Hooks still redirect —
  logging path is fire-and-forget with a `warn` line.

## Implementation References

### Domain

- `packages/domain/src/exam/mutations.ts` — `createExamRecord`,
  `updateExamRecord`, `publishExam`, `deleteExamDraft`, `archiveExam`,
  `unarchiveExam`, `setExamBoardFrozen`, `freezeExamBoard`,
  `unfreezeExamBoard`, `assertExamManagePermission`.
- `packages/domain/src/exam/session.ts` — `startSession`,
  `startSessionWithGate`, `heartbeat`, `heartbeatWithThrottle`,
  `endSession`, `recordEvent`, `autoCloseForExam`,
  `releaseSessionAsInstructor`, `getActiveSessionContext`,
  `requireActiveSessionForUserExam`, `START_GRACE_MS`,
  `HEARTBEAT_EVENT_THROTTLE_MS`.
- `packages/domain/src/exam/submissions-matrix.ts` —
  `getExamSubmissionsMatrix`.
- `packages/domain/src/exam/detail.ts` — `getExamDetailPage`.
- `packages/domain/src/exam/queries.ts` — `listForCourse`, `getExamDetail`,
  `checkExamIpAccess`.
- `packages/domain/src/shared/ip-utils.ts` — `checkIpLock`, `isIpInCidr`,
  `isIpInWhitelist`.
- `packages/domain/src/shared/page-lock.ts` — `getPageLockedContext`.
- `packages/domain/src/proctoring/gate.ts` — `checkProctoringGate` /
  `checkExamGate`.
- `packages/domain/src/proctoring/violation-logger.ts` — `logViolationInTx`.

### Schema

- `packages/core/src/schemas/exam.ts` — `examCreateSchema`,
  `examUpdateSchema`, `examSettingsFormSchema`.
- `packages/core/src/types.ts` — `ipLockFields`, `ipLockFormFields`,
  `ipViolationModeSchema`, `scoreboardModeSchema`.
- `packages/db/prisma/schema/contest.prisma` — `Exam`, `ExamProblem`,
  `ExamParticipation`, `ActiveExamSession`, `ExamSessionEvent`,
  `IpViolationLog`, enums `ExamStatus`, `ExamSessionReleaseReason`,
  `ExamSessionEventType`, `IpViolationMode`, `IpViolationType`.

### Temporal

- `packages/temporal/src/workflows/exam-auto-close.ts` —
  `examAutoCloseWorkflow`.
- `packages/temporal/src/activities/exam-session.ts` —
  `closeActiveSessionsForExam`.
- `packages/job-dispatch/src/dispatch.ts` — `dispatchExamAutoClose`.

### Routes / API

- `apps/web/src/hooks.server.ts` — page lock redirect + visibility-lost
  logging + security headers.
- `apps/web/src/lib/server/exam-lock.ts` — `getActiveExamContext`,
  `isAllowedPathForExam`.
- `apps/web/src/lib/server/page-lock.ts` — re-export of domain helper.
- `apps/web/src/routes/(app)/exams/[examId]/+page.server.ts` —
  `startExam`, `updateSettings`, `publishExam`, `deleteExam`,
  `archiveExam`, `unarchiveExam`, `freezeBoard`, `unfreezeBoard`,
  `updateProblems` actions.
- `apps/web/src/routes/(app)/exams/[examId]/problems/[problemId]/+page.server.ts`
  — in-session workspace loader.
- `apps/web/src/lib/server/shared/client-ip.ts` — `getClientIp`
  (Cloudflare-only trust model).

### Tests

- `tests/unit/domain/exam-session.test.ts` — start/end/heartbeat/
  release paths.
- `tests/unit/domain/exam-publish-delete.test.ts` — lifecycle
  transitions + freeze/unfreeze.
- `tests/unit/domain/exam-auto-close.test.ts` — auto-close workflow +
  activity.
- `tests/unit/domain/exam-submissions-matrix.test.ts` — matrix cells.
- `tests/unit/domain/proctoring-gate.test.ts` — exam gate + IP checks.
- `tests/unit/domain/ip-utils.test.ts` — CIDR matching + fail-closed.
- `tests/e2e/advanced-mode-lifecycle.test.ts` — (skipped) WIP E2E.

## Open Questions / TODO

- Should unarchive reset `frozenBoard` state? Current code leaves it as
  whatever it was before archive. Probably fine, but confirm with a
  real instructor workflow.
- No UI for bulk-releasing all active sessions (staff can only release
  one student at a time). Low priority until we hit a class-wide
  outage scenario.
- `ActiveExamSession.ipPin` duplicates the intent of
  `ExamParticipation.ipPin`. Session-level pin is the Phase 4 source of
  truth; participation-level pin is legacy and flagged for removal in a
  future pass (see schema.prisma comment).
