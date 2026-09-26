# Courses, contests, exams and scoring decisions

Durable decisions for courses and rosters, standalone contests, assignments, course exams, clarifications, activity scoring and grading, exam proctoring and plagiarism detection. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Product Sense](../product/PRODUCT_SENSE.md) and the [feature specs](../features/) ([assignments](../features/assignments.md), [contests](../features/contests.md), [exams](../features/exams.md), [proctoring](../features/proctoring.md), [plagiarism](../features/plagiarism.md)).

### ASM-01 Course exams and standalone contests are separate entities

**Decided:** 2026-04 · **Source:** [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md), [2026-04-16-cuid-url-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-16-cuid-url-unification-design.md)

`Exam` always belongs to a course, carries proctoring (page lock, IP whitelist/binding) and has draft/published status. `Contest` is always standalone (public or invite-only), with no `courseId` and no proctoring fields. They differ in permissions, proctoring defaults and participant model.

- Rejected: one `Contest` table with an optional `courseId` (replaced); giving contests exam-style proctoring parity (2026-04 plan, only the shared gate module shipped; for contests it checks publish state and time window only).
- Rule: Do not add `courseId` or proctoring fields to `Contest`, and do not model course exams as contests.
- Rule: A submission belongs to at most one context (see DAT-03 in data.md).
- Code: `packages/db/prisma/schema/contest.prisma`, `packages/application/src/proctoring/gate.ts`

### ASM-02 One course UI for every role

**Decided:** 2026-04 · **Source:** [2026-04-11-course-experience-redesign-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-course-experience-redesign-design.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md)

Teachers, TAs and students share the `/courses/[courseId]` tab tree; management controls sit next to the objects they act on and Settings is visible to teachers and TAs only. The split student/`/manage` trees duplicated components and navigation.

- Rejected: a separate `/manage/*` teacher tree (removed); a cross-course teacher health dashboard, a student Progress tab and a per-course progress heatmap (dropped).
- Rule: Gate controls inside the shared pages; do not reintroduce a parallel teacher-only route tree.
- Rule: Platform teacher/admin create courses; course teacher/TA manage them; only teachers (or admins) change roles. Class statistics and other members' emails are staff-only.
- Code: `apps/web/src/routes/(app)/courses/[courseId]/`, `packages/application/src/course/members.ts`

### ASM-03 Enrollment is teacher-driven bulk handle paste only

**Decided:** 2026-04 · **Source:** [2026-04-11-course-experience-redesign-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-course-experience-redesign-design.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md)

Teachers and TAs paste handles, which are parsed and deduplicated; existing users are added, unknown handles become pending roster rows, and results are reported after submit. The team did not want the complexity of self-serve join; course `visibility` and `locale` were dropped too.

- Rejected: `CourseJoinToken`, join links, QR codes, join requests, self-join and a preview step.
- Rule: Do not reintroduce self-serve course join.
- Code: `packages/application/src/course/members.ts` (`parseHandleInput`)

### ASM-04 Roster rows are durable memberships independent of user accounts

**Decided:** 2026-09 · **Source:** [2026-09-07-course-roster](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-07-course-roster.md), [2026-09-08-prod-roster-release](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-prod-roster-release.md)

`CourseMembership` holds exactly one of `userId` / `pendingUsername`, unique per course, so teachers can enroll and grade by student ID before accounts exist; a later account with the matching username binds automatically. Placeholder users and `UserStatus` were removed; the membership user FK is `Restrict` and account deletion anonymizes/disables.

- Rejected: placeholder Users; invitation/approval workflows; guessing or adding school prefixes (teachers enter the full username: NTNU bare ID, `ntu_`, `ntust_`); fabricating participation/submission rows for pending members.
- Rule: The course grading subject is `courseMembershipId`; contests keep `userId`. Shared matrix DTOs key by `rowId` and never label membership IDs as user IDs.
- Rule: Pending rows appear in staff rosters, matrices, gradebook, CSV and counts; notifications target linked users only; activity counts reflect real submissions only.
- Rule: Enrollment/identity writers take the roster identity advisory lock, then course locks in sorted ID order; bind, username update and grade merge commit atomically, with DB uniqueness as the final guard. On same-course merge the school roster row and its conflicting scores/feedback/role win, both audit histories are kept, and a removed status is never reactivated by login.
- Rule: Generic better-auth profile updates must not bypass the application username mutation. Teachers may correct an unlinked pending username in place.
- Code: `packages/db/prisma/schema/course.prisma` (`CourseMembership`), `packages/application/src/course/members.ts`

### ASM-05 TAs may remove students only

**Decided:** 2026-09 · **Source:** [2026-09-21-course-member-removal](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-21-course-member-removal.md)

Active TAs can remove student members (linked or pending) but cannot remove TAs, promote, or change roles or usernames; owner, teacher, inactive-actor and cross-course protections remain. Loaders expose per-member permissions so the UI hides controls the server would deny.

- Rule: Authorize inside the locked domain transaction; the server validates direct requests regardless of UI.
- Rule: Parse form action results with SvelteKit `deserialize`, not `res.ok` (HTTP-200 failures were shown as success).
- Code: `packages/application/src/course/members.ts`

### ASM-06 Contest management is owner-or-admin through one pure primitive

**Decided:** 2026-04 · **Source:** [2026-04-11-contest-hide-problems-and-tabs-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-contest-hide-problems-and-tabs-design.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md)

`canManageContest` is a pure function over plain data (null user is false): the contest creator or a platform admin manages it. Creating a contest requires platform teacher or admin (`canCreateCourse`). The `/contests` list merges managed contests (any status, including drafts) with published participable ones without duplicates and tabs by status via `?tab=`.

- Rejected: course teacher/TA management (contests no longer have `courseId`); co-organizers (deferred to a future `ContestOrganizer` design); letting any authenticated user create contests (2026-04, reverted); separate Participable/Managed tabs.
- Rule: Every contest-manager check goes through `canManageContest`; no DB access inside it.
- Code: `packages/application/src/contest/permissions.ts`, `packages/application/src/contest/queries.ts` (`listContestsForUser`)

### ASM-07 Contest problems are withheld from non-managers until start

**Decided:** 2026-04 · **Source:** [2026-04-11-contest-hide-problems-and-tabs-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-contest-hide-problems-and-tabs-design.md), [2026-04-11-contest-hide-problems-and-tabs](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-contest-hide-problems-and-tabs.md)

The domain layer computes `problemsHidden = !isManager && now < startsAt` and returns `problems: null` (deliberately withheld, not `[]`), for every contest with no opt-in. Problems used to leak in the page payload, and an opt-in flag risked owners forgetting it.

- Rejected: UI-only link disabling; a per-contest opt-in flag; showing problem count or points before start.
- Rule: Never send problem IDs, titles or points to non-managers before `startsAt`; the start instant reveals (strict `<`).
- Rule: Compute `now` once per request and pass it through. Non-manager problem pages redirect to the contest before start and out of contest context after end.
- Code: `packages/application/src/contest/queries.ts` (`resolveVisibility`), `apps/web/src/routes/(app)/contests/[contestId]/problems/[problemId]/+page.server.ts`

### ASM-08 ICPC penalty counts only judged wrong attempts; penalty minutes per contest

**Decided:** 2026-06 · **Source:** [2026-06-13-domjudge-alignment-followup](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-13-domjudge-alignment-followup.md)

Compile errors, system errors and non-final statuses (`pending_upload`, `queued`, `compiling`, `running`) are not penalized attempts. `Contest.penaltyMinutesPerWrong` defaults to 20 and `frozenAt` is editable in settings. Charging CE/SE penalties was a bug.

- Rejected: DOMjudge four-level tiebreak and per-problem points editing (deferred as optional).
- Rule: `computeProblemCountPenalty` is the single meeting point for scoreboard display and persisted score; change penalty rules only there.
- Code: `packages/application/src/scoring/problem-count.ts` (`NON_PENALIZED_STATUSES`)

### ASM-09 Upsolve, virtual contests and class analytics derive from existing data

**Decided:** 2026-05 · **Source:** [2026-05-16-analytics-virtual-contest-upsolve](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-16-analytics-virtual-contest-upsolve.md)

Course analytics is staff-only aggregation with no schema change. Upsolve appears only after `endsAt` as a read-only index into practice problem pages. Virtual runs start only for ended contests, last the original duration, derive status from time, and show a private scoreboard with the original final standings as ghost rows; they are stored as `Participation` rows with `type = virtual`.

- Rejected: a Temporal workflow for virtual contests; changing upsolve gates; a separate `VirtualContest` model (folded into `Participation`).
- Rule: No virtual runs of running contests; virtual scoreboards stay private and are computed at read time.
- Code: `packages/application/src/virtual-contest/queries.ts`, `apps/web/src/routes/(app)/contests/[contestId]/`

### ASM-10 One clarification board for contests, exams and assignments

**Decided:** 2026-04 · **Source:** [2026-04-19-clarification-board-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-clarification-board-design.md), [2026-04-19-clarification-board-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-clarification-board-plan.md)

A single `Clarification` model keyed by `contextType` + `contextId`, optionally linked to a problem (`SetNull` on problem delete), with the answer inline and states `pending -> answered | dismissed`. Participants had no in-platform channel and hints reached students unevenly. Only participants (contest/exam participants, active course students) ask; admins and staff never ask, so staff cannot plant hints as student questions. Answering follows the submission-context staff matrix.

- Rejected: a separate answer table; a dedicated audit table (`answeredBy`, `updatedAt` and logs suffice).
- Rule: Allowed transitions are `pending -> answered`, `pending -> dismissed`, `answered -> answered` (edit); nothing leaves `dismissed`.
- Rule: Asking and answering are limited to the context's active window; reads stay open afterwards. Asking is rate-limited to 5 per (user, context) per 10 minutes.
- Code: `packages/db/prisma/schema/clarification.prisma`, `packages/application/src/clarification/permissions.ts`, `packages/application/src/clarification/mutations.ts`

### ASM-11 Clarifications are private until answered publicly, askers are anonymous to non-staff, and only the first answer notifies

**Decided:** 2026-07 · **Source:** [2026-04-19-clarification-board-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-clarification-board-design.md), [2026-04-19-clarification-board-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-clarification-board-plan.md)

A non-staff viewer sees their own questions plus answers staff marked `isPublic` (default false). The DB stores the real `askedByUserId`, but projections drop the author for anyone who is not staff/admin of the context; the viewer's own rows carry only an `isMine` flag. Anonymity lowers the barrier to asking while staff stay accountable. The asker gets one durable `clarification_answered` notification on `pending -> answered`, deduplicated by clarification ID; edits and dismissals send nothing. Staff can reply with fixed canned templates (noComment, readProblem, yes, no), which are always public, to speed replies and reduce hint leakage.

- Rejected: Earlier: every question visible to all participants while pending (2026-04, ICPC-style transparency) — replaced by per-answer `isPublic` in migration `20260702140000_clarification_visibility`. Earlier: no "you asked this" marker, so askers were anonymous even to themselves (2026-04) — the `isMine` badge now marks the viewer's own rows. Notifying on dismissal (judged passive-aggressive).
- Rule: Non-staff JSON never includes `askedByUserId`/`askedBy`; SSE/pub-sub carrying identity goes only to staff channels or is re-masked per subscriber.
- Rule: Elimination in very small rooms is an accepted limit.
- Rule: Answer edits must not create another notification.
- Code: `packages/application/src/clarification/queries.ts`, `packages/application/src/clarification/permissions.ts`, `apps/web/src/routes/api/clarifications/[id]/replies/+server.ts`

### ASM-12 Late policy: activity-level due date, hard close, flat or daily penalty

**Decided:** 2026-09 · **Source:** [2026-09-08-late-submission-policy](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-late-submission-policy.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md), [2026-04-09-problem-ui-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-09-problem-ui-redesign.md), [2026-05-18-feature-completion-batch](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-18-feature-completion-batch.md)

Assignments and exams share `dueAt` (on-time) plus a hard deadline (`Assessment.closesAt` / `Exam.endsAt`) and at most one late penalty in `adjustmentRules`: `flat_late_penalty` or `daily_late_penalty`, where any fraction of a late day counts as a full day. An absent or equal due date means no late window; the allow-late toggle is form state only. Penalties are applied after judging to the raw score because instructors set one policy per homework. The late rule stays editable in settings; `time_bonus` exists in the schema but is not exposed.

- Rejected: per-problem rules in `judgeConfig` and custom scoring scripts; half-life `late_penalty_decay`; `final_day_zero` and `startFrom` variants (normalized away in migration, no runtime compat layer); persisting an allow-late boolean; a `time_bonus` UI.
- Rule: No official submission at or after the hard deadline; due equality is on-time; practice never affects official grades.
- Rule: Percentage penalties apply only to point-sum exams. Running activities must not acquire an earlier deadline or a different penalty; hard-deadline changes reschedule exam auto-close.
- Rule: Settings updates preserve unrelated `time_bonus` rules and their order; existing grades are not rewritten.
- Code: `packages/core/src/schemas/assessment-adjustments.ts` (`extractLatePenalty`)

### ASM-13 Attempt limits are per problem per daily window; rejudges are controllable

**Decided:** 2026-06 · **Source:** [2026-06-04-rejudge-ops-attempt-limit](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-04-rejudge-ops-attempt-limit.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md)

`maxAttemptsPerDay` (renamed from `maxAttempts` so the old name did not change meaning) caps attempts per problem per window, which resets at `attemptResetMinuteOfDay` (0-1439, Asia/Taipei, default 300 = 05:00). Batch rejudges expose progress and cancel to the requester or an admin (see SEC-13 in security.md); cancel does not undo finished rejudges because rejudge is idempotent.

- Rejected: a per-assignment total cap; whole-hour-only reset setting; notifying students when a rejudge changes their score.
- Rule: Enforcement and display share `attemptWindowStart`; the server check is the final guard. A rejudge never consumes an attempt.
- Code: `packages/application/src/submission/attempt-window.ts`, `packages/application/src/submission/rejudge-control.ts` (`queryRejudgeProgress`, `cancelRejudge`)

### ASM-14 Assessment lifecycle audit outlives the assessment; timeline reads existing logs

**Decided:** 2026-05 · **Source:** [2026-05-18-feature-completion-batch](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-18-feature-completion-batch.md), [2026-05-20-grading-feedback-audit-batch-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-20-grading-feedback-audit-batch-design.md)

`AssessmentAuditLog` records publish, revert_to_draft and delete_draft in the same transaction as the change, with `assessmentId` as a plain string (no FK) so rows survive deletion and system actions recording `actorUserId = null`. The staff audit tab is a read-only merged timeline over existing audit tables (assessment, score override, rejudge) rather than new tables.

- Rule: Every lifecycle transition, including automatic ones, writes an audit row.
- Code: `packages/db/prisma/schema/course.prisma` (`AssessmentAuditLog`), `packages/application/src/audit/queries.ts`

### ASM-15 Timed-context scoring is shared pure code behind one orchestrator

**Decided:** 2026-06 · **Source:** [2026-06-11-triplet-model-convergence-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-triplet-model-convergence-design.md), [2026-06-11-post-audit-next-phase](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-post-audit-next-phase.md), [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md)

Scoreboard and scoring algorithms are entity-agnostic pure functions in `@nojv/application` (not in Temporal activities). Contest, exam and virtual participations share one `Participation` table (see DAT-04 in data.md). Contest and exam persisted-score updates share `runScoreUpdate(adapter)`, which owns the retry loop, scoring-mode branch and the pure `computeBestScoreState` / `computeProblemCountState`; writes use an optimistic-lock `version`. Duplicated persistence caused a shipped P1 where exam judging never updated scores.

- Rejected: forking scoring per entity; one four-way implementation including virtual contests (computed at read time) and assignments (aggregate on read), whose shapes differ.
- Rule: New timed-scoring contexts add an adapter and never copy the retry loop; score writes go through versioned update with retry.
- Rule: The judge workflow picks the branch with pure `resolveScoringDispatch`.
- Code: `packages/application/src/scoring/run-score-update.ts`, `packages/application/src/scoring/persist-core.ts`

### ASM-16 Raw problem scores and activity point allocation are separate

**Decided:** 2026-09 · **Source:** [2026-06-29-problem-total-score](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-06-29-problem-total-score.md), [2026-09-08-assessment-problem-weights](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-assessment-problem-weights.md), [2026-07-10-gradebook-public-profile](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-gradebook-public-profile.md)

A Standard problem's raw total is the sum of its testcase-set weights (each scored all-or-nothing, see JDG-04 in judge.md); an Advanced problem's is `advancedConfig.maxScore` (default 100). Submissions, overrides and adjustment rules stay on that raw scale. Assignments and exams carry per-problem allocated `points` (Decimal) and a `totalPoints` derived as their sum, which the gradebook and activity totals use; teachers need weighted totals independent of raw maxima. Exam participation scores are recomputed through durable work with revision checks; assignments compute on read.

- Rejected: using raw maxima directly as allocations; a raw-only gradebook with no weighting (2026-07, teachers computed ratios from CSV) — replaced by allocated points; allocation reasons and audit history (removed on request).
- Rule: `totalPoints` is always the sum of allocations; the editor starts a newly added problem at 100 points.
- Rule: Reordering or unrelated saves must not round legacy allocations; migrations leave existing official grades unchanged; concurrent grading/judging must not persist an obsolete revision.
- Rule: Contest scoring and problem versioning are unaffected by activity weighting. Students see only their own gradebook row.
- Code: `packages/application/src/scoring/activity-points.ts`, `packages/application/src/course/gradebook.ts`, `packages/application/src/problem/total-score.ts`

### ASM-17 Score overrides are per membership, reasoned, audited, and never for contests

**Decided:** 2026-04 · **Source:** [2026-04-19-rejudge-and-score-override-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-rejudge-and-score-override-design.md), [2026-09-21-exam-access-safety](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-21-exam-access-safety.md), [2026-09-07-course-roster](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-07-course-roster.md)

An override sets a student's final raw score for one problem in one assignment or exam, independent of any submission, for partial credit, zeroing a cheater while keeping evidence, or makeup scores. It replaces the best score unconditionally (it may be lower). A reason is required and every create, update, delete and merge writes an append-only audit row.

- Rejected: practice overrides (no final score); an optional reason; contest overrides (backend removed when contest management tabs were unified); contest overrides keyed by `userId`.
- Rule: One override per (membership, problem, assignment-or-exam) with XOR context CHECK; activity deletion cascades, membership removal does not.
- Rule: Students see only an "adjusted" marker, never the reason; keep staff and student projections separate.
- Rule: Contest scoring and scoreboards never read overrides.
- Code: `packages/core/src/schemas/score-override.ts`, `packages/db/prisma/schema/submission.prisma` (`ScoreOverride`)

### ASM-18 Grading happens after close; feedback is its own table

**Decided:** 2026-05 · **Source:** [2026-05-20-grading-feedback-audit-batch-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-20-grading-feedback-audit-batch-design.md), [2026-05-22-feedback-audit-and-plagiarism-trigger-log-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-22-feedback-audit-and-plagiarism-trigger-log-design.md)

Override and feedback mutations by non-admins fail with 409 until the context closes; platform admins bypass for emergency fixes. Student-visible feedback lives in `SubmissionFeedback` (assignment or exam, exactly-one CHECK, unique per context/problem/membership) so teachers can comment on full-score cells without an override, and students see it only after close. `SubmissionFeedbackAuditLog` records every create/update/delete and survives feedback deletion (FK set null).

- Rejected: a feedback column on `ScoreOverride`; contest feedback; an audit UI or retention cap.
- Rule: `assertContextClosed` guards every override and feedback mutation for non-admins.
- Code: `packages/application/src/shared/context-window.ts`, `packages/application/src/score-override/permissions.ts`, `packages/application/src/feedback/permissions.ts`

### ASM-19 Exam confinement is a server-side session lock enforced in the global hook

**Decided:** 2026-04 · **Source:** [2026-03-20-page-lock-ip-lock-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-03-20-page-lock-ip-lock-design.md), [2026-04-11-course-experience-redesign-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-course-experience-redesign-design.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md)

With page lock on, starting an exam creates an `ActiveExamSession` and `hooks.server.ts` redirects every request outside an allow-list (the exam's pages plus submission, auth and health APIs) back to the exam. Exits are hand-in, end time (Temporal auto-close) or instructor release; session events are appended to `ExamSessionEvent`. The earlier single-page guard left every other route open.

- Rejected: per-route/per-loader guards (coverage gaps). New-tab or second-device use stays a human invigilation problem.
- Rule: Enforcement belongs in the global hook; routes a locked user must reach are added to the allow-list explicitly, and exam APIs (release/end) stay exempt.
- Rule: At most one un-ended active session per user; session events are append-only.
- Code: `apps/web/src/hooks.server.ts`, `apps/web/src/lib/server/exam-lock.ts`, `apps/worker/src/workflows/exam-auto-close.ts`

### ASM-20 Exam IP rules: whitelist and first-binding, gated on every request, fail closed

**Decided:** 2026-05 · **Source:** [2026-03-20-page-lock-ip-lock-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-03-20-page-lock-ip-lock-design.md), [2026-05-26-exam-ip-gating-hardening-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-26-exam-ip-gating-hardening-design.md), [2026-05-18-feature-completion-batch](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-18-feature-completion-batch.md)

A CIDR whitelist and first-visit IP binding are independent toggles sharing `ipViolationMode`: `block` denies, `notify` allows and logs. During an active exam session the hook runs `checkProctoringGate` on every page and `/api` request, and submission re-checks it. Violations are logged in both modes, throttled to one per 60s per (exam, user, type), and capped at the newest 2000 rows per exam, pruned in the insert transaction. Teachers can reset one student's binding (clears the pin, 10-minute grace, next machine re-pins).

- Rejected: a single unenforced `ipLockEnabled` flag; Earlier: fail-open active-exam context lookup for availability (2026-05) — now fails closed with 503; a whole-exam IP kill switch; extra anti-spoofing beyond the `CF-Connecting-IP` trust model.
- Rule: The IP decision is the pure `evaluateIpLock`; CIDR matching handles IPv4, IPv6 and IPv4-mapped IPv6; only trust `CF-Connecting-IP` in production (see SEC-09 in security.md).
- Rule: Notify mode never silently drops a violation; path matching uses strict prefixes.
- Rule: The first IP pin is a conditional write (`ipPin IS NULL` with a count check); a request that loses is evaluated against the winner's pin, never re-pins.
- Rule: Exam entry runs the proctoring gate before any session or participation write; a denied entry creates no session.
- Rule: Gate denials inside a transaction are returned and raised after commit, so violation rows survive a rejected entry or submission; every binding reset writes an `ip_reset` session event.
- Code: `packages/application/src/shared/ip.ts`, `packages/application/src/proctoring/violation-logger.ts`, `packages/db/src/repositories/ip-violation.ts`, `packages/application/src/exam/session.ts`

### ASM-21 Exam submissions are scoped to the exam and final after hand-in

**Decided:** 2026-09 · **Source:** [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-09-08-exam-submission-finality](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-08-exam-submission-finality.md)

Exam submissions and code drafts must target a problem linked to the exam (a confined examinee could otherwise get verdicts on any public problem). Ending an exam ends the session and marks participation submitted in one transaction; a submitted student cannot start again, while instructor release still allows re-entry.

- Rejected: rewriting historical data to reconstruct erased release reasons.
- Rule: Every context-bound submission path checks problem membership in that context.
- Rule: Student start, end and exam submission admission serialize on the per-user advisory lock; repeated end is idempotent; submissions already accepted may finish judging after hand-in.
- Code: `packages/application/src/submission/creation.ts`, `packages/application/src/exam/session.ts`

### ASM-22 Exam-scoped expiring passwords as an extra login path

**Decided:** 2026-09 · **Source:** [2026-09-21-exam-access-safety](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-21-exam-access-safety.md)

Each published exam issues one credential per active bound student membership, 24 hours before start via durable work; username plus a valid exam password creates a Better Auth session tied to the credential revision that becomes invalid after the hard end. Passwords are stored recoverably encrypted plus a verification hash and mailed only to the account security email. Students need exam login without their OAuth accounts, which stay intact.

- Rejected: carrying credentials in generic notification payloads.
- Rule: Only active course teachers/TAs or effective admins view or change credentials; no plaintext passwords in logs, audit metadata, job payloads or student page data.
- Rule: Exam-password sessions cannot change permanent credentials or security settings.
- Rule: Rate-limit attempts per normalized username + IP (5 per 15 minutes); a Redis failure rejects authentication.
- Code: `packages/db/prisma/schema/exam-credential.prisma`, `apps/web/src/lib/server/exam-password-auth.ts`

### ASM-23 Plagiarism detection runs Dolos in-process in the worker

**Decided:** 2026-04 · **Source:** [2026-04-20-dolos-migration-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-20-dolos-migration-design.md), [2026-04-20-dolos-migration-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-20-dolos-migration-plan.md)

`@dodona/dolos-lib` runs inside the worker, per (problem, language) group, on each user's best submission, skipping groups under two submissions. Pairs are flat `{problemId, userId1, userId2, similarity 0-100, longest, overlap}` with one symmetric score. MOSS lacked Go/Rust parsers, needed egress to a no-SLA third party and returned placeholder scores; Dolos is MIT, uses tree-sitter and needs no network.

- Rejected: MOSS plus an HTML scraper; a separate Dolos service; a feature flag or dual path (one-shot cutover); per-submission-set caching; cross-language pairing; per-side similarities and `mossUrl`; migrating historical MOSS results (staff re-run).
- Rule: Detection makes no outbound network calls; pairs compare within one language.
- Rule: Keep Dolos and other native addons out of the web image and `@nojv/application`.
- Code: `apps/worker/src/activities/plagiarism.ts`, `packages/application/src/plagiarism/types.ts`

### ASM-24 Plagiarism results are curatable and re-runs leave a receipt

**Decided:** 2026-05 · **Source:** [2026-04-30-functional-gaps](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-30-functional-gaps.md), [2026-05-22-feedback-audit-and-plagiarism-trigger-log-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-22-feedback-audit-and-plagiarism-trigger-log-design.md)

Staff (course staff, contest owner, admins) can flag a pair as a false positive via `PlagiarismPairFlag`, unique on (context type, context ID, sorted `userA|userB|problemId` key); flagged pairs are hidden by default and pairs open in a side-by-side diff. Each re-run first writes a `PlagiarismTriggerLog` receipt (who, when, `priorPairCount`) before overwriting the previous result, answering "did someone wipe evidence?".

- Rejected: the original "no review UI" non-goal; a JSON snapshot of the wiped result (YAGNI); a trigger-log UI.
- Code: `packages/db/prisma/schema/plagiarism.prisma`, `packages/application/src/plagiarism/flags.ts`, `packages/application/src/plagiarism/queries.ts`

### ASM-25 Course management authority is one active-membership check; ownership is not a grant

**Decided:** 2026-09 · **Source:** this PR

Whether an actor manages a course is decided only by `resolveCourseRole` in `packages/application/src/shared/permissions.ts`: an effective admin, or an active teacher/TA membership. `Course.ownerId` records who created the course and anchors deletion and roster protections, but grants nothing on its own. Creating a course writes the owner's active teacher membership in the same transaction, and roster changes, merges and removals refuse to demote or remove the owner, so the owner always manages through that membership. Course creation and copying check `canCreateCourse` (platform teacher/admin) inside the application functions, so a course TA who is a platform student cannot create a course by copying one.

- Rejected: treating `ownerId` as an extra manager grant in some pages (plagiarism pair view, announcement actions, context submission lists); it diverged from layouts and member management and would bypass a removed owner membership. Checking course creation only in the `/courses/new` route.
- Rule: Web routes and application code call `isCourseManager`, `getCourseRole` or `assertCourseManager`; do not re-derive manager status from `ownerId` or raw membership fields.
- Rule: Every path that creates a course (new, copy) enforces `canCreateCourse` in the application layer and creates the owner's active teacher membership.
- Code: `packages/application/src/shared/permissions.ts`, `packages/application/src/course/mutations.ts`, `apps/web/src/lib/server/auth.ts`
