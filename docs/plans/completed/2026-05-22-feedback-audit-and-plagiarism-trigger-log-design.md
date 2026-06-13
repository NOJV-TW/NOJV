# Feedback Edit History + Plagiarism Trigger Log + Route Tests

**Date:** 2026-05-22
**Scope:** Two new write-only audit tables (`SubmissionFeedbackAuditLog`, `PlagiarismTriggerLog`) and route-level permission tests for the plagiarism API surface.
**Status:** Design approved — proceed to implementation.

## Background

Three follow-ups carried over from prior spec "Open Questions":

1. `SubmissionFeedback` upsert overwrites the previous comment with no trail. `assignments.md:328-332` flagged this as "Revisit if a 'who said what when' trail becomes a requirement". The requirement is now real.
2. Re-triggering Dolos plagiarism detection silently overwrites the prior pair result on `CourseAssessment.plagiarism*` / `Exam.plagiarism*` / `Contest.plagiarism*`. `plagiarism.md:330-332` flagged this as "If 'did someone wipe evidence?' becomes a governance question, a `PlagiarismTriggerLog` table is needed".
3. `plagiarism.md:325-326` notes route-level permission tests are still missing — `trigger / view / source fetch` gates have unit coverage on the domain helpers but no end-to-end assertions through the SvelteKit route handlers.

## Scope decisions (already made with user, 2026-05-22)

- **Write-only MVP.** Neither audit log gets new UI. Future polish if real audit workflow surfaces.
- **PlagiarismTriggerLog records "the receipt only"** — `triggeredByUserId`, `triggeredAt`, `priorPairCount`. No JSON snapshot of the wiped result. If "what was wiped" becomes a question later, extend the table; YAGNI for now.
- **No retention cap.** Both tables are low-volume by nature (teacher edits a comment a handful of times; plagiarism re-trigger is rare). Revisit if cardinality explodes.

## Feature 1 — `SubmissionFeedbackAuditLog`

### Schema

`SubmissionFeedback` uses two nullable columns (`courseAssessmentId` / `examId`) with a CHECK that exactly one is non-null. The audit log mirrors that shape so the (context, problem, student) tuple matches the parent without an extra enum.

```prisma
enum SubmissionFeedbackAction {
  create
  update
  delete
}

model SubmissionFeedbackAuditLog {
  id                 String   @id @default(cuid())
  feedbackId         String?  // SetNull after parent feedback deleted — audit survives
  studentUserId      String
  problemId          String
  courseAssessmentId String?
  examId             String?
  action             SubmissionFeedbackAction
  oldComment         String?  @db.Text
  newComment         String?  @db.Text
  changedByUserId    String?
  createdAt          DateTime @default(now())

  feedback  SubmissionFeedback? @relation(fields: [feedbackId], references: [id], onDelete: SetNull)
  changedBy User?               @relation("SubmissionFeedbackAuditChanger", fields: [changedByUserId], references: [id], onDelete: SetNull)

  @@index([courseAssessmentId, problemId, createdAt(sort: Desc)])
  @@index([examId, problemId, createdAt(sort: Desc)])
  @@index([studentUserId, problemId, createdAt(sort: Desc)])
}
```

Migration adds the same CHECK constraint as `SubmissionFeedback` itself (exactly one of `courseAssessmentId` / `examId` non-null) so the audit table can never end up with an ambiguous context row.

### Write points

`packages/application/src/feedback/mutations.ts`:

- `upsertFeedback`: inside the existing `prisma.$transaction` block. Read the row before upsert; if it exists, write `action = update` with `oldComment = existing.comment, newComment = input.comment`; if not, write `action = create` with `oldComment = null, newComment = input.comment`. Then upsert the row.
- `deleteFeedback`: inside a new `prisma.$transaction` (the current implementation is a plain `delete`). Read the row, write `action = delete` with `oldComment = existing.comment, newComment = null`, then delete the row.

`changedByUserId` is the actor's `userId` from the calling context.

### Semantics notes

- `update` rows where `oldComment === newComment` are still written (idempotent edits are recorded). Cleaner than guessing.
- An `upsertFeedback` call against a non-existing row writes one `create` row; against an existing row writes one `update` row. Never both.

## Feature 2 — `PlagiarismTriggerLog`

### Schema

Reuses the existing `PlagiarismContext` enum (`assessment | exam | contest`).

```prisma
model PlagiarismTriggerLog {
  id                String            @id @default(cuid())
  contextType       PlagiarismContext
  contextId         String
  triggeredByUserId String?
  /// pair count on the parent before this trigger overwrote it; 0 if no prior run
  priorPairCount    Int
  triggeredAt       DateTime          @default(now())

  triggeredBy User? @relation("PlagiarismTriggerLogTriggerer", fields: [triggeredByUserId], references: [id], onDelete: SetNull)

  @@index([contextType, contextId, triggeredAt(sort: Desc)])
}
```

### Write point

`packages/application/src/plagiarism/triggers.ts` (or wherever the existing `triggerPlagiarismScan` lives — verify during implementation):

1. Read the existing `plagiarismResultJson` / `plagiarismPairCount` from the parent row.
2. Compute `priorPairCount` (length of pairs array, or 0 if no prior run).
3. Write the `PlagiarismTriggerLog` row.
4. Dispatch the workflow as today.

The order matters: the log is written **before** the dispatch overwrites the parent. The whole "read prior + write log + dispatch" block runs inside a single `prisma.$transaction` so a crash mid-flow leaves both prior result and log intact.

## Feature 3 — Route-level permission tests

New file `tests/integration/api/plagiarism.test.ts`, modelled on `tests/integration/api/feedback.test.ts`. Covers four gates:

| Route                                                         | Method | Tested actors                                                                                   |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `/api/plagiarism/[assignmentId]/reports`                      | POST   | student → 403; teacher of another course → 403; same-course TA → 2xx; admin → 2xx               |
| `/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]` | GET    | student (even the source owner) → 403; other-course teacher → 403; same-course TA + admin → 2xx |
| `/api/plagiarism-flags`                                       | POST   | student → 403; other-course teacher → 403; same-course TA + admin → 2xx                         |
| `/api/plagiarism-flags/[id]`                                  | DELETE | student → 403; other-course teacher → 403; same-course TA + admin → 2xx                         |

Each test seeds: one course with one assignment, one teacher, one TA, one student in that course, one other-course teacher, one admin. Reuses the existing seed helpers in `tests/fixtures/`.

## Migration

Single migration `20260522000000_add_feedback_audit_and_plagiarism_trigger_log` introducing both tables plus the `SubmissionFeedbackAction` enum and CHECK constraint.

## Rollout order

1. Schema + migration + repos (deterministic, no logic change).
2. Domain TDD: `feedback/mutations.test.ts` extended with audit assertions, then implementation; same for `plagiarism/triggers.test.ts`.
3. Route tests added.
4. Doc sweep: remove Open-Question bullets from `assignments.md` and `plagiarism.md`; `git mv` this design plan to `completed/`.

## Verification

- `pnpm -w typecheck` 17/17
- `pnpm lint` 18/18
- `pnpm -w format` clean
- `pnpm test:unit` — new feedback audit + plagiarism trigger unit tests pass
- `pnpm test:integration` — new plagiarism route tests pass

No dev server, no UI change.

## Risks

| Risk                                                                    | Mitigation                                                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `priorPairCount` computation reads stale data under concurrent triggers | Wrap the read-log-dispatch sequence in a single tx; concurrent triggers serialize via row-level lock on the parent CourseAssessment / Exam / Contest. |
| Cascade delete of a course wipes feedback rows; audit gets orphaned     | `feedbackId` is `SetNull` so the audit row survives; `studentUserId` / `problemId` are plain String fields, not FK, so they also survive.             |
| Trigger log table grows unboundedly                                     | Low volume by design (plagiarism re-trigger is rare); revisit retention cap if cardinality > 10k per context.                                         |
| Adding CHECK to audit table breaks rollback                             | Matches the existing CHECK on `SubmissionFeedback`; if rollback ever drops the parent CHECK, audit CHECK should be dropped in the same migration.     |

## Related Docs

- [Quality Score](../../operations/QUALITY_SCORE.md)
- [Plagiarism Spec](../../specs/plagiarism.md)
- [Assignments Spec](../../specs/assignments.md)
- Memory: [[explicit-non-goals]], [[project_submission_permission_rule]]
