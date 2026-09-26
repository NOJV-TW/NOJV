# Feature: Course Exams

Acceptance spec for course exams (`Exam`, routes `/exams/[examId]/...`). Students start a session to see and submit problems; exams can add page lock and IP rules ([Proctoring](proctoring.md)). A Temporal workflow closes sessions at `endsAt`. Afterwards students get a review page and practice access at `/problems/[id]`.

## Key code

- `packages/application/src/exam/mutations.ts` — `createExamRecord`, `updateExamRecord`, `publishExam`, `deleteExamDraft`
- `packages/application/src/exam/session.ts` — `startSession`, `startSessionWithGate`, `endSession`, `recordEvent`, `autoCloseForExam`, `releaseSessionAsInstructor`, `releaseAllSessionsAsInstructor`, `resetStudentIpBinding`, `listActiveSessions`, `getActiveSessionContext`, `getSessionState`, `listSubmittedProblemIds`, `requireActiveSessionForUserExam`, `START_GRACE_MS`
- `packages/application/src/exam/credentials.ts` — temporary exam passwords
- `packages/application/src/exam/detail.ts` (`getExamDetailPage`), `exam/submissions-matrix.ts` (`buildExamSubmissionsMatrix`), `exam/scoring.ts` (`updateExamScores`), `exam/queries.ts` (`listExamIpViolations`)
- `packages/application/src/clarification/` — `ask`, `answer`, `dismiss`, `listForViewer`, `canSeeAuthor`
- `packages/application/src/feedback/`, `score-override/permissions.ts`, `shared/context-window.ts`, `audit/queries.ts` — post-close grading and audit
- `packages/core/src/schemas/exam.ts`, `schemas/exam-credential.ts`; `packages/db/prisma/schema/contest.prisma` (`Exam`, `ExamProblem`, `Participation`, `ActiveExamSession`, `ExamSessionEvent`, `IpViolationLog`), `exam-credential.prisma`
- Worker: `apps/worker/src/workflows/exam-auto-close.ts`, `apps/worker/src/activities/lifecycle.ts` (`closeActiveSessionsForExam`)
- Web: `apps/web/src/hooks.server.ts`, `apps/web/src/lib/server/exam-lock.ts`, `apps/web/src/routes/(app)/exams/[examId]/+page.server.ts` (actions `startExam`, `releaseSession`, `releaseStudentSession`, `releaseAllSessions`, `resetStudentIpBinding`, `updateCredentialPassword`, `updateSettings`, `updateProblems`, `publishExam`, `deleteExam`), `exams/[examId]/problems/[problemId]/`
- Tests: `tests/unit/application/exam-session.test.ts`, `exam-publish-delete.test.ts`, `exam-auto-close.test.ts`, `exam-submissions-matrix.test.ts`, `proctoring-gate.test.ts`; `tests/integration/api/exam-session.test.ts`; `tests/e2e/advanced-mode-lifecycle.test.ts`

## Model

- `status` is `draft | published`; no archive state. "Ended" is `endsAt < now`. Exams have no revert-to-draft and no lifecycle audit log.
- `scoringMode` accepts only `point_sum`; official scores use [activity allocations](#activity-allocations). `scoreboardMode` (`hidden | live | frozen`, default `hidden`) is a stored setting; exams have no scoreboard page and no freeze control.
- Proctoring fields: `pageLockEnabled`, `ipWhitelistEnabled`, `ipWhitelist`, `ipBindingEnabled`, `ipViolationMode`. Participants are `Participation` rows with `type = exam`, which hold the IP pin.
- Publishing, or creating as published, ensures the auto-close workflow; a window change on a published exam replaces it; deleting a draft cancels it.
- Manager tabs: Results (grades, plagiarism, audit), Proctoring (sessions, students and sign-in, IP records), Settings last.

Out of scope: invite codes (membership gates access), remote proctoring (webcam, screen recording, lockdown browser), a late flag in the matrix.

## Temporary exam sign-in

Decision: ASM-22. Security model: [Security](../operations/SECURITY.md).

- Exams opt in at creation (`examPasswordEnabled`, default off). Enabled, published exams issue an independent username/password credential for each active, linked student membership at `startsAt - 24 hours`. The minute-based durable processor catches late enablement, publication and enrollment. Unlinked roster rows show an account-linking status and get no mail until a User exists.
- Credentials never replace OAuth bindings or a permanent password. Current course managers can reveal and set the password under Proctoring → Students and sign-in. Edits require 12–64 characters, rotate the credential revision, invalidate its sessions and enqueue an updated email.
- Validity starts at the earlier of `startsAt - 24 hours` and the first SMTP attempt, and ends at `endsAt` (hard end, not `dueAt`). The first real SMTP attempt, including ambiguous or failed ones, permanently locks the setting (`examPasswordLockedAt`); test-sink delivery does not. Disabling before the lock revokes credentials and their sessions in the same transaction; after it, disabling fails. Extending `endsAt` extends attached session expiry. A password change, withdrawal, course archive, account disable or promotion, or security-generation change invalidates the temporary session on its next request.
- A password login can use ordinary coursework before entering the exam; after starting, confinement applies only if page lock is on.
- Only ordinary students qualify: platform admins and teachers, super admins, and users with an active teacher/TA membership anywhere keep their usual sign-in, so a staff-visible password never grants staff access.
- Email goes only to the verified `User.email`. Delivery work carries credential ID and revision, never plaintext; it decrypts just before sending. Suppressed or unverified recipients are shown to staff; suppressed mail is never reported as sent. Transport acceptance is not inbox proof.
- Password-derived sessions carry an immutable marker and credential-revision link, checked on every request including direct Auth API calls. They cannot change account security, link providers, create permanent tokens or get registry credentials.
- At the hard end the password is rejected immediately; reconciliation later removes password material and sessions. Students then use their usual sign-in for review.

## Acceptance criteria

### Create, publish, delete

- Problem selection follows [Assignments — problem ownership and forks](assignments.md#problem-ownership-and-forks) (PRB-10); detaching keeps the library relation.
- Management requires a bound, active course teacher/TA membership or effective admin access; the creator alone, pending usernames and removed memberships grant nothing; an active TA who is a platform student is allowed. Archived courses reject mutations.
- Auto-close is ensured only after the create or publish transaction commits.
- `publishExam` requires a draft (`"Only draft exams can be published."`), a positive allocation total (`"Add at least one problem worth points before publishing or saving a published activity."`, which also covers an exam with no problems), ≥1 language (`"Select at least one allowed language before publishing."`), a valid window (`"endsAt must be later than startsAt."`), a valid late policy, and `endsAt > now` (`"End time must be in the future."`).
- `deleteExamDraft` on a non-draft fails with `"Only draft exams can be deleted."`.

### Late collection

`dueAt` is the on-time deadline; `endsAt` is the hard end for submissions, sessions, proctoring, grading access and practice after close. Formulas: [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#adjustment-rules); policy: ASM-12.

- Without late collection the form saves `dueAt = endsAt`; a null `dueAt` also means no late window. Enabled late collection requires `startsAt < dueAt < endsAt` and one penalty: none, fixed percentage or daily percentage.
- Any fraction of a late day counts as a whole day: exactly due is on time, 1 ms late and exactly 24 h late are day one, 24 h + 1 ms is day two.
- Submission acceptance and scoring stop at `endsAt`; `dueAt` never releases sessions. The workspace switches from an on-time countdown to a labelled final countdown. The overview shows both deadlines and the penalty before start.
- After start, `startsAt` is fixed, `endsAt` and `dueAt` extend only (`"Running exams may only extend their final collection time."`, `"dueAt can only be extended, not moved earlier."`), and penalties cannot change. After end, deadlines and penalties are read-only. Extending `endsAt` replaces the auto-close workflow.
- Course copy keeps due/final dates and penalty rules.

### Activity allocations

Exams follow the [activity allocation and official score contract](assignments.md#activity-allocation-and-official-scores).

- Each grading change enqueues durable `score.converge` work for every participant in the same transaction. Convergence uses non-sample submissions before `endsAt`, never dispatches judging, and retries on conflict. Writeback checks both the activity `gradingRevision` and the participation version, so stale scores never replace current ones.
- Entering an exam serializes against the grading transaction, so a new participant starts at the current revision. While any participant lags, the detail page shows a recalculation notice; detail and matrix scores compute from current allocations.

### Session start

- `startSessionWithGate` requires a published exam (else `NotFoundError`), `now >= startsAt - START_GRACE_MS` (5 min) and `now < endsAt` (else `HttpError` 410 `"Exam has not started yet."` / `"Exam has ended."`), and an active course membership (`"You must be enrolled in the course to access this exam."`).
- Inside the per-user session lock it runs the exam proctoring gate (publish state, membership, archive, time window with the same grace, IP rules for the request IP) before any session or participation write. A denial commits only the gate's own writes (violation log, pin of an existing participation) and creates or reopens no session: `ip_whitelist` / `ip_binding` give `ForbiddenError("Exam entry blocked: your network does not match the exam's IP restrictions.")`; time denials give the 410 errors above.
- It then creates or reopens the `ActiveExamSession`, records an `enter` event, activates the participation and returns `created: true`. A second call for the same exam returns the existing session with `created: false`.
- With IP binding on, a first entry that creates the participation pins the request IP with a conditional write in the same transaction; if the pin is already taken the entry fails with `ConflictError` and creates no session.
- A user has at most one active session globally: an active session on another exam gives `ConflictError("You already have an active session on a different exam.")`.
- Archived course: `ForbiddenError("This course is archived; new exam sessions are not allowed.")`. Sessions already running when the course is archived continue.
- A submitted session or submitted participation gives `ForbiddenError("You have already submitted this exam.")` before any write.
- The `startExam` action passes the client IP to `startSessionWithGate`; the request hook keeps enforcing the gate afterwards.

### Hand-in

- The workspace timer links to the overview, where an "End exam" area opens an irreversible-action dialog with focus on Cancel. The dialog, rules list and start modal state that only answers submitted with Submit are graded, and the dialog names problems with no non-sample submission (`listSubmittedProblemIds`). Cancel does nothing.
- Confirming (`releaseSession` → `endSession`) closes the session with `releaseReason: submitted` and marks the participation `submitted` with the same time. Repeating keeps the original time and adds no event.
- Start, end and exam submission admission share a per-user advisory lock: after hand-in, stale tabs cannot submit; already admitted submissions finish judging.
- A submitted student sees a submitted notice without start controls or problem links while the exam runs; the review page appears after `endsAt`.
- After an instructor release a student may re-enter while the window is open and they have not submitted; a hand-in from a stale tab still finalizes.

### Problem access during the exam

- With an active session on exam E, `/exams/E` shows the problem list (links to `/exams/E/problems/[id]`); without one it shows the rules card and start CTA. `startExam` reloads the exam page rather than opening the first problem.
- `/exams/E/problems/[problemId]` without an active session on E throws `ForbiddenError("No active exam session for this exam.")`; after `endsAt` it redirects to `/problems/[problemId]?ended=exam`.

### Page lock

- `pageLockEnabled: true`: a request outside `/exams/E` (API paths excepted) records `visibility_lost` with `metadata.attemptedPath` and redirects 307 to `/exams/E`. Some APIs stay blocked; see [Proctoring](proctoring.md#page-lock).
- `pageLockEnabled: false`: other authorized pages, other submission contexts and submission history stay usable; the session stays active.
- The active session and setting are read on every request, so changes apply to the next request.
- The setting does not observe tab switching, copy/paste or leaving NOJV. Exam pages and exam submissions always enforce membership, time and IP rules.
- A failing `recordEvent` logs a warning and still redirects.

### Auto-close and instructor release

- At `endsAt` the auto-close workflow calls `autoCloseForExam`, which checks the exam's schedule revision and fingerprint and then sets `endedAt`, `releaseReason = time_up` and an `auto_close` event on every active session. Re-runs are no-ops.
- `releaseSessionAsInstructor({ examId, targetUserId })` by active course staff ends the session with `released_by_instructor` and a `release` event carrying `{ reason, endedByUserId }`. Non-staff get `"Only course staff can release exam sessions."`; no active session gives `NotFoundError`.
- `releaseAllSessionsAsInstructor({ examId })` ends every active session in one transaction and returns `{ released, releasedUserIds }`; zero sessions returns `released: 0`. Unknown exams give `NotFoundError`.
- `resetStudentIpBinding` clears the student's IP pin, grants a 10-minute IP-gate exemption and always records an `ip_reset` event with `{ resetByUserId, clearedIpPin, exemptUntil }`, under the student's session lock. A student who never entered gets a closed session row (`endedAt` set, no `releaseReason`) to hold the event; `endSession` treats that row as no session, and the next start reopens it.

### IP rules

- Whitelist, binding, violation modes and logging are specified in [Proctoring](proctoring.md) (ASM-20).

### Drafts

- With an active session on a running exam, `PUT /api/drafts` stores drafts under the `exam:<examId>` context key per problem and language (WEB-05).
- Without an active session, after the exam ended, or for a problem outside the exam, saving fails with `ForbiddenError` or `NotFoundError` and stores nothing.
- During an active session, reading drafts for any other context is `ForbiddenError`; exam drafts never start from homework or practice drafts. Drafts are never graded and are visible only to their owner.

### Submission history

Tracking rules: PRB-21.

- Switching problems while one is judging keeps its request and tracking; completion refreshes the problem switcher scores. Reload, a new tab, reconnect or returning to the foreground resumes tracking for authorized pending submissions.
- While a newer rejudge is queued or running, old verdicts, scores and details stay hidden. A terminal system error without a result file is not shown as pending.
- Student history loads 50 more rows at the bottom with no cap; a failed load keeps rows and offers retry; loaded rows keep updating; new rows show a view-latest prompt without moving the reading position.
- Staff history uses numbered 50-row pages over a stable snapshot; background updates keep filters, page, unsaved settings/allocation drafts and their grading revision.
- A history cursor must match user, problem, context and active-exam scope; otherwise a generic 400.

### Submissions matrix

- `buildExamSubmissionsMatrix` has one row per course student membership (including pending usernames) and per-problem cells `{ score, attempts, state }` from non-sample submissions before `endsAt`, with overrides applied.
- `state`: `ac` when the raw best reaches the problem's raw maximum, `partial` when positive but lower, `zero` when zero, `empty` with no submissions.

### Grading after close

- While `endsAt > now` the grading entry is hidden with a "grading available after close" note. After close, a cell opens the drawer with override and feedback keyed by `(course membership, problemId, examId)`.
- Non-admin writes before close fail with `ConflictError("This context is still open; grading is only available after it closes.")`; admins bypass (ASM-18).
- Students see feedback only after close, on the submission detail page. The review page shows per-problem state and total but not feedback.

### Audit timeline

- Staff see a read-only, newest-first merge of `ScoreOverrideAuditLog` and `SubmissionRejudgeLog` for the exam's submissions.

### Review and practice after close

- `getExamDetailPage` returns `null` (404) to non-managers only for drafts. For ended exams it adds per-problem `viewerState` (`ac | partial | zero | empty`) and the viewer's total score.
- Students with a participation row can open attached problems at `/problems/[id]` (PRB-20); context-less submissions there are practice only.

### Clarifications

One board for assignments, exams and contests (`ClarificationContext`); decisions ASM-10 and ASM-11.

- Only participants ask (contest/exam participants, active course students); staff and admins never ask. Asking and answering are limited to the context's active window; reading stays open. Asking is limited to 5 per user and context per 10 minutes.
- States: `pending → answered | dismissed`, `answered → answered` (edit); nothing leaves `dismissed`.
- `answer(id, { isPublic })` stores `Clarification.isPublic` (default false). Public answers broadcast an `updated` SSE event on the public channel; private ones go to the staff channel. The asker gets one `clarification_answered` notification on the first answer; edits and dismissals notify nobody. Canned replies are always public.
- Non-staff `listForViewer` returns their own questions plus public ones, flagged `isMine`; the author is removed for non-staff.
- Asking pushes nothing to peers; the question goes live only to staff.
