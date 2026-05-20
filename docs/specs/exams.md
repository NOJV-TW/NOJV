# Feature: Course Exams

Acceptance spec for course-embedded exams (`Exam` /
`/exams/[examId]/...`). Exams are proctored in-class assessments: students
must start a session, are locked to the exam routes until release, and may
be IP-bound or IP-whitelisted. When the window ends, a Temporal workflow
auto-closes every active session; post-close students rely on the
practice-after-close route through `/problems/[id]` (the exam detail page
itself is staff-only once `endsAt < now`).

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
- As a **teacher**, I want a submissions matrix (students × problems,
  best score + attempts + AC/partial/zero cells) that recomputes on every
  load, so that I can spot-check performance without running SQL.
- As a **proctor / teacher on duty**, I want to release a stuck student's
  session manually (`releaseSessionAsInstructor`), so that an edge case
  like a crashed browser doesn't block them from a retry.

## Scope

### In scope

- `Exam` CRUD — create, partial update, publish, delete-draft. Parallel
  shape to `CourseAssessment`. Persistent `status` is `draft | published`
  only — there is no `archived` enum value. "Ended" is purely time-
  derived from `endsAt < now`.
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
- Proctoring sub-tab — manager-only `IpViolationLog` viewer wired into
  the exam detail page via `ExamProctoringTab.svelte`.
- Post-close grading drawer on the submissions matrix — score
  overrides + per-cell student-visible feedback comments
  (`SubmissionFeedback`). Writes gated post-close (`endsAt < now`),
  admin bypass.
- Audit sub-tab — staff-only merged feed of score override + rejudge
  events (`listAuditTimelineForContext({ type: "exam", id })`).
  Exams have no lifecycle audit log.
- Post-close student review block: ended exams (`endsAt < now`) hide the
  detail page from students (`getExamDetailPage` returns null for
  non-managers). Practice-after-close still allows accessing the
  problems via `/problems/[id]` (no context).
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

### Delete-draft

- GIVEN a non-draft exam, WHEN `deleteExamDraft` runs,
  THEN `ValidationError("Only draft exams can be deleted.")`.

### Session — startSessionWithGate

- GIVEN an exam in `published` status with `now >= startsAt -
START_GRACE_MS` (5 min) and `now < endsAt`, and the actor is an active
  course member, WHEN `startSessionWithGate` is called,
  THEN a new `ActiveExamSession` is created (carrying only
  `userId`, `examId`, `startedAt`, `lastHeartbeatAt` — IP binding lives
  on `ExamParticipation.ipPin`, not the session row), an `enter` event
  is recorded, and the result includes `created: true`.
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
- GIVEN a course staff actor, WHEN `releaseAllSessionsAsInstructor({
examId })` is called, THEN every currently-active session for the exam
  is ended in one transaction — each gets `endedAt`, `releaseReason =
'released_by_instructor'`, and a `release` event carrying
  `metadata.endedByUserId` — and the call returns `{ released: <count> }`.
- GIVEN an exam with zero active sessions, WHEN bulk release runs,
  THEN `{ released: 0 }` — a no-op, not an error.
- GIVEN an unknown `examId`, WHEN single or bulk release runs,
  THEN `NotFoundError`.
- `countActiveSessions(examId)` returns the active-session count behind
  the proctoring-tab badge and the "release all" affordance.

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

- Exams do not support manual scoreboard freezing — `scoreboardMode`
  alone drives visibility (`hidden` / `live` / `frozen`). The contest
  use-case for instructor-controlled freeze does not apply to in-class
  exams where the assessment ends at `endsAt`.

### Submissions matrix

- WHEN `getExamSubmissionsMatrix(examId)` is called, THEN `rows` lists
  each active-student member of the parent course once with cells per
  problem. Each cell carries `{ problemId, score, attempts, state }`.
- `state === 'ac'` iff `best >= problem.points`; `'partial'` iff
  `0 < best < problem.points`; `'zero'` iff `best === 0`; `'empty'` iff
  no submissions (`attempts === 0`).
- Only non-sample submissions (`sampleOnly: false`) count toward the
  matrix.

### Grading — post-close drawer

- GIVEN an exam with `endsAt > now`, WHEN a manager opens the
  submissions matrix, THEN the grading drawer entry button is hidden
  and a "grading available after close" note is shown. The drawer
  cannot be opened.
- GIVEN an exam with `endsAt < now`, WHEN a manager opens a matrix
  cell, THEN the grading drawer shows two sections (score override
  and student-visible feedback comment) keyed on
  `(studentUserId, problemId, examId)`.
- GIVEN a non-admin manager actor with `now < endsAt`, WHEN
  `createOverride` / `updateOverride` / `deleteOverride` or
  `upsertFeedback` / `deleteFeedback` is called against the exam,
  THEN `ConflictError("Grading is only available after the exam has
ended.")` (post-close gate via `assertContextClosed`).
  `platformRole === "admin"` bypasses the gate.
- WHEN `getFeedbackForStudent` is called by a student while the exam
  is still running, THEN it returns nothing; once `endsAt < now`, the
  per-problem comment is surfaced on the submission detail page (the
  exam detail page itself is staff-only post-close, so the
  assignment-style detail surface is not available).

### Audit timeline

- GIVEN a staff viewer (course teacher/TA or platform admin), WHEN
  they open the Audit sub-tab on the exam manage page, THEN
  `listAuditTimelineForContext({ type: "exam", id })` returns a
  reverse-chronological merge of `ScoreOverrideAuditLog` (override
  changes) + `SubmissionRejudgeLog` (rejudges scoped to the exam's
  submissions). No lifecycle audit-log source exists for exams.
- The view is read-only — no new audit rows are written when the tab
  is loaded.

### Practice-after-close

- GIVEN an ended exam (`endsAt < now`, `status = 'published'`) that the
  student has a participation row on, WHEN they visit `/problems/[id]`
  for an attached problem (no context), THEN the page loads via the
  `assertProblemViewAccess` historical-participant gate.
- WHEN the same student POSTs to `/api/submissions` WITHOUT exam context
  on the same problem, THEN the submission is accepted as practice (no
  scoreboard write, no matrix contribution, no participation update).

### Post-close review block

- GIVEN a student on `/exams/[examId]` for an exam with `endsAt < now`,
  WHEN `getExamDetailPage` is called with `isManager: false`, THEN it
  returns `null` and the loader 404s.
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
- **Auto-close workflow idempotence.** The workflow only runs once per
  publish dispatch; replays after the exam is past `endsAt` are no-ops
  because `autoCloseForExam` finds zero active sessions.
- **`recordEvent('visibility_lost')` fails.** Hooks still redirect —
  logging path is fire-and-forget with a `warn` line.

## Implementation References

### Domain

- `packages/domain/src/exam/mutations.ts` — `createExamRecord`,
  `updateExamRecord`, `publishExam`, `deleteExamDraft`,
  `assertExamManagePermission`.
- `packages/domain/src/exam/session.ts` — `startSession`,
  `startSessionWithGate`, `heartbeat`, `heartbeatWithThrottle`,
  `endSession`, `recordEvent`, `autoCloseForExam`,
  `releaseSessionAsInstructor`, `releaseAllSessionsAsInstructor`,
  `countActiveSessions`, `getActiveSessionContext`,
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

- `packages/core/src/schemas/exam.ts` — `examCreateSchema`,
  `examUpdateSchema`, `examSettingsFormSchema`.
- `packages/core/src/types.ts` — `ipLockFields`, `ipLockFormFields`,
  `ipViolationModeSchema`, `scoreboardModeSchema`.
- `packages/db/prisma/schema/contest.prisma` — `Exam`, `ExamProblem`,
  `ExamParticipation`, `ActiveExamSession`, `ExamSessionEvent`,
  `IpViolationLog`, enums `ExamStatus`, `ExamSessionReleaseReason`,
  `ExamSessionEventType`, `IpViolationMode`, `IpViolationType`.
- `packages/db/prisma/schema/submission.prisma` —
  `SubmissionFeedback` (assignment + exam contexts).
- `packages/core/src/schemas/feedback.ts` — `feedbackUpsertSchema`.

### Temporal

- `packages/temporal/src/workflows/exam-auto-close.ts` —
  `examAutoCloseWorkflow`.
- `packages/temporal/src/activities/exam-session.ts` —
  `closeActiveSessionsForExam`.
- `packages/temporal/src/dispatch.ts` — `dispatchExamAutoClose`.

### Routes / API

- `apps/web/src/hooks.server.ts` — page lock redirect + visibility-lost
  logging + security headers.
- `apps/web/src/lib/server/exam-lock.ts` — `getActiveExamContext`,
  `isAllowedPathForExam`.
- `apps/web/src/lib/server/page-lock.ts` — re-export of domain helper.
- `apps/web/src/routes/(app)/exams/[examId]/+page.server.ts` —
  `startExam`, `updateSettings`, `publishExam`, `deleteExam`,
  `updateProblems`, `releaseStudentSession`, `releaseAllSessions`
  actions. Also loads `listExamIpViolations` for the
  Proctoring sub-tab when the viewer is a manager. Exams have no
  scoreboard freeze/unfreeze surface: by product design, students do not
  see other students' submissions during the exam, so freezing is moot —
  `scoreboardMode` alone drives visibility.
- `apps/web/src/routes/(app)/exams/[examId]/problems/[problemId]/+page.server.ts`
  — in-session workspace loader.
- `apps/web/src/lib/server/shared/client-ip.ts` — `getClientIp`
  (Cloudflare-only trust model).

### Tests

- `tests/unit/domain/exam-session.test.ts` — start/end/heartbeat/
  release paths.
- `tests/unit/domain/exam-publish-delete.test.ts` — lifecycle
  transitions (publish + delete-draft).
- `tests/unit/domain/exam-auto-close.test.ts` — auto-close workflow +
  activity.
- `tests/unit/domain/exam-submissions-matrix.test.ts` — matrix cells.
- `tests/unit/domain/proctoring-gate.test.ts` — exam gate + IP checks.
- `tests/unit/domain/ip-utils.test.ts` — CIDR matching + fail-closed.
- `tests/integration/api/exam-session.test.ts` — session start / end /
  heartbeat / single + bulk instructor release against a real DB.
- `tests/e2e/advanced-mode-lifecycle.test.ts` — (skipped) WIP E2E.
