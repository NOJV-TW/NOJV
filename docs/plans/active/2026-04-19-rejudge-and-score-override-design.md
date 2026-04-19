# Rejudge + Score Override — Teacher Correction Primitives

**Date:** 2026-04-19
**Scope:** Extend existing `rejudgeWorkflow` with new scopes and permissions; add `SubmissionRejudgeLog` audit table; add `ScoreOverride` model + domain module + API routes + UI; wire both into the scoring read path
**Status:** Design approved, awaiting implementation

## Background

Two gaps block real classroom use:

1. **Teachers cannot re-run judging** after a testcase fix, a checker bug fix, or a flaky sandbox run. The only current recourse is asking students to resubmit — which loses the original submission timestamp and, during a timed window, is impossible.
2. **Teachers cannot manually adjust a student's per-problem score.** Common needs: giving partial credit for TLE on a logically correct answer, docking a cheater to zero while retaining the submission as evidence, awarding a makeup score to a student who was absent.

## Existing Infrastructure

Rejudge is **partially built**:

| Piece | State |
| --- | --- |
| `rejudgeWorkflow` (10-parallel batch of child `submissionJudgeWorkflow`) | ✅ exists at `packages/temporal/src/workflows/rejudge.ts` |
| `dispatchRejudge` client helper | ✅ exists at `packages/job-dispatch/src/dispatch.ts:68` |
| `fetchSubmissionIdsForRejudge` activity → `submissionDomain.findForRejudge` | ✅ exists |
| `RejudgeInput = { problemId; contestId?; assessmentId? }` | ⚠️ missing single-submission mode, missing `examId`, no user filter |
| UI entry point anywhere | ❌ none |
| Permission gate | ❌ none (anyone reaching dispatch can trigger) |
| Audit log | ❌ none |

Score override has **nothing** built.

## Feature 1 — Rejudge

### Scope: three entry points

| Scope | Where | Input |
| --- | --- | --- |
| **A. Per-problem, all submissions** | Problem admin page | `{ problemId }` |
| **B. Per-problem, filtered** | Problem admin page (advanced filters) | `{ problemId, contestId? \| assessmentId? \| examId?, userIds?, dateRange? }` |
| **C. Single submission** | Submission detail page | `{ submissionId }` |

All three funnel through `dispatchRejudge`. `RejudgeInput` is extended to a discriminated union so the workflow can branch:

```ts
type RejudgeInput =
  | { mode: "batch"; problemId: string; contestId?: string; assessmentId?: string; examId?: string; userIds?: string[]; since?: string; until?: string; triggeredByUserId: string }
  | { mode: "single"; submissionId: string; triggeredByUserId: string };
```

`submissionDomain.findForRejudge` updates to handle both modes. `single` returns at most one row; `batch` runs the filter query.

### Permission rule (shared with Score Override)

Derived from the project memory on submission-context permissions:

| Submission context | Allowed actors |
| --- | --- |
| `practice` (no assessment/contest/exam) | Platform admin + problem author |
| `assignment` | Platform admin + course teacher/TA of that course |
| `exam` | Platform admin + course teacher/TA of that course |
| `contest` | Platform admin + contest organizer |

**Problem author rejudge rights cover practice context only.** Once a problem is embedded into an assignment/exam/contest, rejudge authority transfers to the context owner. This rule is enforced in the new `canRejudgeSubmission(actor, submission)` helper in `packages/domain/src/submission/authz.ts`.

For batch rejudge, the gate is slightly different: caller must be permitted for **every** submission the filter would match. Enforced by an upstream `assertBatchRejudgeAccess(actor, input)` that runs the filter as `count()` and cross-checks `actor.canOperateOn(context)` before dispatch. If any submission is outside the actor's authority, the whole batch is rejected with a clear "scope exceeds your permission" error.

### Per-submission semantics (in-place overwrite + audit)

When each child `submissionJudgeWorkflow` runs for a rejudged submission:

1. Snapshot `{ verdict, score, passedCount, resultJson, executionMs, memoryKb }` into a new `SubmissionRejudgeLog` row.
2. Overwrite the `Submission` row with fresh results (same rail as the original judge).
3. Emit the normal post-judge hooks (scoreboard update, stats recompute) so all downstream state stays consistent.

```prisma
model SubmissionRejudgeLog {
  id                 String   @id @default(cuid())
  submissionId       String
  rejudgeRunId       String?  // null for single-mode rejudges; set for batch
  rejudgedByUserId   String
  oldVerdict         String
  oldScore           Int
  oldResultJson      Json?
  newVerdict         String
  newScore           Int
  newResultJson      Json?
  createdAt          DateTime @default(now())

  submission         Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  rejudgedBy         User       @relation(fields: [rejudgedByUserId], references: [id], onDelete: SetNull)

  @@index([submissionId, createdAt(sort: Desc)])
  @@index([rejudgedByUserId, createdAt(sort: Desc)])
}
```

Admin view of this log is a later polish; MVP only writes the rows.

### Execution model: fire-and-forget

Trigger returns 202 + a toast "Queued N submissions for rejudge." No progress page, no cancellation button, no batch-level UI. The workflow runs; per-submission judge workflows write results independently; scoreboard and stats refresh automatically via the existing post-judge rail.

If an admin wants "did my rejudge finish?", they can refresh the target page and check; a UI for `RejudgeRun` aggregates is explicitly deferred.

### Downstream state: automatic cascade

Each child `submissionJudgeWorkflow` already triggers `updateScoreboard` + `updateUserStats` + `publishVerdict` on completion. Rejudge reuses that rail unchanged. No extra cascade work.

**Freeze interaction:** if a contest scoreboard is frozen when a rejudge fires, the freeze snapshot is untouched (matching freeze semantics); the live key updates; unfreeze reveals the new value. This is the existing freeze/unfreeze contract, no change.

### Student notification: none

Score changes from rejudge are silent. No `score_rejudged` entry in the Notification enum. Student sees the new value next time they load the relevant page.

## Feature 2 — Score Override

### Scope: per (student, problem, context), not per submission

The unit is "the student's final score for this problem in this assessment/exam/contest." It does not attach to a specific submission. If the student has overrideScore = 80 and later submits a 100-point perfect run, the displayed score stays 80 until the override is edited or removed.

Override does **not** apply to `practice` context — practice has no concept of "final score" the way a course or contest does.

```prisma
model ScoreOverride {
  id                  String         @id @default(cuid())
  userId              String
  problemId           String
  contextType         OverrideContextType
  contextId           String         // assessmentId | examId | contestId
  overrideScore       Int
  reason              String         @db.Text
  createdByUserId     String
  updatedByUserId     String
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  user                User           @relation("ScoreOverrideUser", fields: [userId], references: [id], onDelete: Cascade)
  problem             Problem        @relation(fields: [problemId], references: [id], onDelete: Cascade)
  createdBy           User           @relation("ScoreOverrideCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)
  updatedBy           User           @relation("ScoreOverrideEditor", fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@unique([userId, problemId, contextType, contextId])
  @@index([contextType, contextId])
}

enum OverrideContextType { assignment exam contest }

model ScoreOverrideAuditLog {
  id               String   @id @default(cuid())
  overrideId       String?  // nullable so post-delete audit survives via onDelete: SetNull
  userId           String
  problemId        String
  contextType      OverrideContextType
  contextId        String
  action           ScoreOverrideAction  // create | update | delete
  oldScore         Int?
  newScore         Int?
  oldReason        String?
  newReason        String?
  changedByUserId  String
  createdAt        DateTime @default(now())

  override         ScoreOverride? @relation(fields: [overrideId], references: [id], onDelete: SetNull)
  changedBy        User           @relation(fields: [changedByUserId], references: [id], onDelete: SetNull)

  @@index([contextType, contextId, createdAt(sort: Desc)])
  @@index([userId, problemId, createdAt(sort: Desc)])
}

enum ScoreOverrideAction { create update delete }
```

`reason` is required on create and update (min length 1, max 500). Delete writes an audit row with `action = delete` and the old score/reason, then drops the ScoreOverride row.

### Permission rule (same as rejudge)

`canSetScoreOverride(actor, { contextType, contextId })` uses the same matrix as rejudge. Problem author gets no special rights here because practice context is excluded from override entirely, so the author's rejudge carve-out doesn't apply.

### Scoring read path integration

The single point that resolves "what score does this student have for this problem in this context" lives in `packages/domain/src/submission/scoring.ts`. Add an override-first read:

```ts
export async function resolveFinalScore(userId, problemId, context) {
  const override = await scoreOverrideRepo.findUnique({ userId, problemId, ...context });
  if (override) return { score: override.overrideScore, source: "override" };
  const bestSubmission = await submissionRepo.findBestScore(userId, problemId, context);
  return { score: bestSubmission?.score ?? 0, source: "submission" };
}
```

Downstream readers already in the codebase:

- Class stats aggregation
- ICPC/IOI scoreboard builders
- Exam submissions matrix
- Per-student assessment grade view

All switch to `resolveFinalScore`. Scoreboard cache invalidation: when an override is created/updated/deleted, enqueue `updateScoreboard({ contextType, contextId })` (contest/exam) or touch class stats cache (assignment) — matching the existing submission post-judge rail.

### Student-facing UI

On the student's own assignment / exam / contest detail page, each problem row shows the final score with a subtle "adjusted" marker when `source === "override"`:

```
Problem 3   85 pts   🛈 manually adjusted
```

**The reason is never shown to the student.** Marker only — it signals "don't file a system bug, the score is intentional." Reason is staff-only.

### Staff-facing UI

A new "Score Overrides" button on the assessment/exam/contest manage page opens a drawer listing overrides for that context, with create/edit/delete. The create form is:

```
Student:     [dropdown of enrolled]
Problem:     [dropdown of attached problems]
Score:       [0–maxScore input]
Reason:      [textarea, required]
```

Edit reuses the same form pre-filled. Delete is a confirm-modal with the current values shown.

### API routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/overrides?contextType=&contextId=` | List overrides for a context. Staff-only. |
| POST | `/api/overrides` | Create (body: userId, problemId, contextType, contextId, overrideScore, reason). |
| PATCH | `/api/overrides/[id]` | Update score and/or reason. |
| DELETE | `/api/overrides/[id]` | Remove. |
| POST | `/api/rejudge` | Dispatch rejudge (single or batch). |

All routes: `requireAuth` + `consumeFormRateLimit` + permission check via the shared helpers.

## Rollout Order (4 commits)

1. **Rejudge extensions + audit log**:
   - Extend `RejudgeInput` discriminated union; update `rejudgeWorkflow` and `fetchSubmissionIdsForRejudge` and `submissionDomain.findForRejudge` to handle single and new filters + exam.
   - Add `SubmissionRejudgeLog` model + migration.
   - Modify `submissionJudgeWorkflow` to snapshot the old Submission state before overwrite when invoked via rejudge (needs a flag in the workflow input to distinguish original judge vs rejudge).
   - Add `canRejudgeSubmission` + `assertBatchRejudgeAccess` authz helpers.
   - `POST /api/rejudge` route + unit + integration tests.

2. **Rejudge UI**:
   - Button on problem admin page (batch, with optional filters for Q1B).
   - Button on submission detail page (single).
   - Confirmation modal + toast.

3. **Score Override domain + API**:
   - `ScoreOverride` + `ScoreOverrideAuditLog` models + migration.
   - `@nojv/domain/score-override/*` module with create/update/delete + audit-write wrapped in tx.
   - `resolveFinalScore` read path integration.
   - 4 API routes.
   - Unit + integration tests.

4. **Score Override UI**:
   - Staff drawer on assessment/exam/contest manage pages.
   - Student-facing "manually adjusted" marker on own detail pages.
   - Paraglide keys.

Split enables each commit to land independently; reviewers see data model changes isolated from UI changes.

## Testing

- **Unit**
  - `scoring.test.ts`: override wins over best submission; no override → best submission; deleted override → falls back.
  - `rejudge-authz.test.ts`: permission matrix enforced for each context type; batch with mixed-context submissions rejects if any fall outside.
  - `override.test.ts`: create writes audit row; update writes audit with before/after; delete writes audit then removes row; reason min length enforced.

- **Integration**
  - `rejudge-integration.test.ts`: seed a problem + 3 submissions, dispatch rejudge, poll until workflow completes, assert `Submission.score` changed AND `SubmissionRejudgeLog` rows exist.
  - `override-scoreboard.test.ts`: create override in contest → scoreboard read reflects the override value.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Batch rejudge of a large class starves live submissions on the judge queue | `JUDGE_TASK_QUEUE` is shared; priority queues are explicitly out of scope — staff are expected to rejudge outside of exam/contest windows. Documented in staff UI. |
| `submissionJudgeWorkflow` replay re-writes audit log on every retry | The snapshot step happens inside an activity with idempotency by `submissionId + attempt`; replay is safe. |
| Override set during contest freeze doesn't affect frozen snapshot | Intentional. Matches existing freeze semantics (scoreboard snapshot is fixed at freeze time). |
| Student sees "manually adjusted" and contacts TA about reason | Reason is staff-internal by design; FAQ can explain the marker. Transparency without disclosing internal notes. |
| Override left stale after student is removed from course | FK cascade on `User` delete cleans overrides; if only `CourseMembership` is removed (not user), the override persists — correct, since the student's prior grade record shouldn't vanish on re-enrollment tweaks. |
| Concurrent override edit by two TAs | `@@unique([userId, problemId, contextType, contextId])` + update-within-tx; second writer's update sees the new version and their reason wins, previous version is captured in the audit log. Acceptable for a low-frequency admin action. |

## Related Docs

- [Product Sense](../../PRODUCT_SENSE.md)
- [Temporal Workflows](../../TEMPORAL.md)
- [Judge Pipeline](../../JUDGE_PIPELINE.md)
- [Redis Architecture](../../REDIS.md)
- Memory: submission operation permission rule
