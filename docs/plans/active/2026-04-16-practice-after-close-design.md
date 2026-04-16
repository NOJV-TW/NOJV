# Practice-After-Close — Unified Post-Deadline Practice for Assignments, Exams, Contests

**Date:** 2026-04-16
**Scope:** Access control (`assertProblemViewAccess`), UI links on `(app)/courses/[courseId]/assignments/[assessmentId]/+page.svelte`, `(app)/courses/[courseId]/exams/[examId]/+page.svelte`, `(app)/contests/[slug]/+page.svelte`, submission mutation guard rails
**Status:** Design approved, awaiting implementation

## Background

Today, when a time-bound activity ends the student is locked out:

| Activity | Behavior after `endsAt` / `closesAt` |
| --- | --- |
| CourseAssessment (作業) | `createQueuedSubmissionRecord` throws `ForbiddenError("Assignment has ended.")` |
| Contest (競賽) | `ensureContestParticipation` throws `ForbiddenError("Contest has ended.")` |
| Exam (考試) | Active session closes; page lock redirects release; problem URLs on the detail page become stale |

A student who wants to revisit the problem — to study a verdict they didn't solve, to practice after the window — has no path. Post-deadline learning is silently blocked by the attribution guard.

## Product Goal

After an activity closes, every problem it contained becomes an ordinary practice problem for every student who was a participant. They can **view**, **submit**, and **see verdicts** — but nothing they do changes the graded score, scoreboard, or attempt tally.

## Decisions

1. **Score freeze is by absence, not by flag.** Post-close submissions carry no assessment/contest/exam context, so they are never seen by score aggregation, scoreboards, the submission matrix, or attempt-per-day counters. No new `late` column, no new filter clauses in aggregation queries.
2. **UI strips context after close.** The three detail pages (`assignments/[id]`, `contests/[slug]`, `exams/[examId]`) link students to `/problems/[id]` (no query params) once the activity's end time has passed. Practice flow takes over from there.
3. **Access check gains a "historical participant" clause.** `assertProblemViewAccess` is the single gate for both viewing and submitting. Extending it covers both read and write with one rule.
4. **Submission guard rails stay.** If a client does hit `POST /api/submissions` with an expired `assessment` or `contestSlug`, `createQueuedSubmissionRecord` still throws — this is intentional belt-and-braces. The frontend simply won't generate those URLs after close.
5. **No per-session endsAt concern.** `Exam.endsAt` is a single uniform timestamp for every participant, so there is no window in which student A (early-submitter) can practice while student B is still taking the exam.

## Access Control Rule

`assertProblemViewAccess(problem, actor, opts)` currently allows:

1. Public problem → anyone logged in
2. Author → always
3. Platform admin → always
4. `opts.contextIncludesProblem === true` → caller has already verified active context

Add a fifth gate, checked in DB when the first four fail:

5. **Historical participant of an ended context that contained this problem:**
   - `CourseAssessmentProblem` join where `assessment.closesAt < now` AND `assessment.status = 'published'` AND the user has an `active` `CourseMembership` on that course, OR
   - `ContestProblem` join where `contest.endsAt < now` AND `contest.visibility = 'published'` AND the user has a `ContestParticipation` row, OR
   - `ExamProblem` join where `exam.endsAt < now` AND `exam.status = 'published'` AND the user has an `ExamParticipation` row.

The new gate fires a single lightweight DB query only when the other four gates reject. Public problems and context-carrying requests bypass it entirely.

### What this rule does NOT allow

- **Ongoing exam — student A finished early:** `exam.endsAt` has not passed, so rule 5 does not fire. Student A still cannot load `/problems/[id]` for an exam problem outside of active exam context. Problem attribution during the exam remains through the existing exam page-lock flow.
- **Enrollee who was never actually dispatched the activity:** rule 5 requires the membership/participation row, not just "they are in the course". A student who dropped the course before the assessment opened and has no `CourseMembership` will not gain access.
- **Admin-only / draft problems on a draft assessment:** the rule filters on `status = 'published'` / `visibility = 'published'`. Draft activities never leak post-close.

## UI Changes

| Surface | Current link | Post-close link |
| --- | --- | --- |
| `assignments/[id]/+page.svelte` student rows | `/problems/[id]?course=X&assessment=Y` | `/problems/[id]` |
| `contests/[slug]/+page.svelte` problem cards | `/contests/[slug]/problems/[id]` | `/problems/[id]` |
| `exams/[examId]/+page.svelte` (student view) | whatever the in-exam page-lock route is | `/problems/[id]` |

The detail pages themselves remain accessible post-close — students can still see the problem list, their frozen score, the submission log, and the scoreboard (contest). Only the outbound problem links change.

A subtle note on the contest detail page: the existing nested `/contests/[slug]/problems/[id]` route is the in-contest working surface (scoreboard context, language restriction, cooldown). After close it should either redirect to `/problems/[id]` server-side or remain functional as a read-only review — preference is **server-side redirect** for consistency with the other two surfaces and to keep one canonical practice URL.

## Submission Path

No change to `createQueuedSubmissionRecord`. The existing path:

1. If payload has no `assessment` / `contestSlug` → treated as practice, no attempt counting, no cooldown, no scoreboard write.
2. If payload has expired context → `ForbiddenError` — serves as belt-and-braces for a hand-crafted request.
3. `assertProblemViewAccess` is called after context validation. The new historical-participant clause grants both the viewer on `/problems/[id]` and the submitter `POST /api/submissions`.

## Non-Goals

- **No "late submission visible in assignment matrix" feature.** Teachers see only pre-close submissions. If that becomes a need, add a `late` boolean and a matrix toggle later — this design does not preempt that decision.
- **No post-close plagiarism re-scan.** MOSS runs on submissions attributed to the assessment; practice submissions aren't. This matches the intent that practice is private learning.
- **No changes to the `(app)/problems/[id]` page itself.** It already supports the no-context practice flow.

## Implementation Plan

### Phase 1 — Access control
1. Extend `assertProblemViewAccess` in `packages/domain/src/problem/helpers.ts` to accept an optional `tx` / repo accessor and perform the historical-participant check when the four synchronous gates reject. Signature becomes async.
2. Update the two callers (`packages/domain/src/submission/mutations.ts`, `apps/web/src/routes/(app)/problems/[id]/+page.server.ts`) to `await`.
3. Unit tests in `tests/unit/domain/problem-access.test.ts`:
   - public / private / author / admin baselines
   - active context passes via `contextIncludesProblem`
   - historical participant passes for each of the three context types after `endsAt/closesAt`
   - historical participant blocked BEFORE `endsAt/closesAt`
   - non-participant in ended context → blocked
   - draft/unpublished context → blocked even for participants

### Phase 2 — UI link swap
4. `assignments/[assessmentId]/+page.svelte`: when `detail.status === "closed"`, problem rows link to `/problems/${problemId}` without query.
5. `contests/[slug]/+page.svelte`: when contest has ended, problem cards link to `/problems/${p.id}` instead of the nested contest route.
6. `exams/[examId]/+page.svelte` (student view): when exam has ended, use `/problems/${problem.id}` for the review entry.
7. `contests/[slug]/problems/[id]/+page.server.ts`: if contest has ended, `redirect(302, '/problems/' + params.id)`.

### Phase 3 — Verification
8. Manual smoke:
   - close an assignment with seeded submissions → student can view + submit post-close, score unchanged, new submission appears in `/submissions`.
   - close a contest → problem review works, scoreboard stays frozen.
   - close an exam → problem review works.
   - during an ongoing exam, a finished-early student cannot access `/problems/[id]` for exam problems.
9. `pnpm -w typecheck && pnpm lint && pnpm test:unit` all green.

## Files Expected to Change

- `packages/domain/src/problem/helpers.ts` — extend `assertProblemViewAccess`
- `packages/domain/src/submission/mutations.ts` — `await` the updated helper
- `apps/web/src/routes/(app)/problems/[id]/+page.server.ts` — `await` the updated helper
- `apps/web/src/routes/(app)/courses/[courseId]/assignments/[assignmentId]/+page.svelte` — conditional link
- `apps/web/src/routes/(app)/courses/[courseId]/exams/[examId]/+page.svelte` — conditional link
- `apps/web/src/routes/(app)/contests/[slug]/+page.svelte` — conditional link
- `apps/web/src/routes/(app)/contests/[slug]/problems/[id]/+page.server.ts` — post-close redirect
- `tests/unit/domain/problem-access.test.ts` — new test file

No schema changes. No new migrations. No new paraglide keys.
