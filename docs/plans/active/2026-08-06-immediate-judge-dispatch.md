# Immediate Judge Dispatch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Start submission judge workflows immediately after the submission transaction commits while preserving durable recovery for every interruption point.

**Architecture:** Keep the PostgreSQL transactional outbox as the recovery source of truth, add an awaited best-effort Temporal dispatch after commit, and leave the existing minute-based processor as the replay path. The deterministic `judge-{submissionId}` workflow ID remains the concurrency fence; Temporal remains responsible for queueing, retries, and resuming in-flight workflows.

**Tech Stack:** TypeScript, SvelteKit, PostgreSQL/Prisma, Temporal TypeScript SDK, Vitest, Playwright.

---

### Task 1: Make the submission job payload single-source and test the fast path

**Files:**

- Modify: `packages/application/src/submission/mutations.ts`
- Modify: `packages/application/src/submission/rejudge-control.ts`
- Test: `tests/unit/domain/submission-mutations.test.ts`
- Test: `tests/unit/domain/submission-dispatch-outbox.test.ts`

**Steps:**

1. Add a small internal builder for `SubmissionJudgeJob` and use it both when enqueueing the transactional outbox row and when dispatching after commit.
2. Add failing tests proving the outbox is written before the direct dispatch attempt, direct dispatch is called after the commit, and a direct Temporal failure leaves the submission queued instead of converting it to `system_error`.
3. Implement `submitAndDispatch()` to await `executeSubmissionJudgeDispatch()` after `createQueuedSubmissionRecord()` succeeds; catch and warn with the submission ID so the persisted outbox remains responsible for retry.
4. Remove the unused enqueue-only `dispatchSubmissionJudge()` application wrapper; retain explicit enqueue and execute functions.
5. Run the focused domain tests.

### Task 2: Preserve and verify Temporal/outbox idempotency and crash recovery

**Files:**

- Modify: `tests/unit/temporal/submission-dispatch.test.ts`
- Modify: `tests/unit/worker/worker-app.test.ts`
- Modify: `tests/integration/temporal/submission-judge-workflow.test.ts`
- Modify: `tests/integration/domain/submission-sweep.test.ts` only if a missing recovery assertion is exposed

**Steps:**

1. Add coverage for direct dispatch and durable replay racing on the same deterministic workflow ID; `WorkflowExecutionAlreadyStartedError` must remain success.
2. Add coverage for a transient judge activity failure followed by success, proving Temporal retry resumes the same workflow rather than creating a second judge.
3. Verify worker startup still sweeps stale in-progress submissions before enqueueing generation-guarded system-error recovery.
4. Verify old pending outbox rows remain claimable by the existing durable-work processor.
5. Run focused unit and Temporal/domain integration tests.

### Task 3: Update architecture and reliability documentation

**Files:**

- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/operations/RELIABILITY.md`

**Steps:**

1. Update the submission sequence to show transactional outbox plus immediate Temporal start.
2. Document the outbox processor as recovery/replay for submissions, not the normal dispatch latency path.
3. State that Temporal connection failure after commit returns `202 queued`; the pending outbox retries later.
4. Preserve the existing guarantees for worker restart, Temporal persistence, activity retry, stale sweeper, fixed workflow IDs, and generation-guarded rejudge.

### Task 4: Verify the complete change

**Steps:**

1. Run focused Vitest unit tests for mutations, outbox dispatch, Temporal dispatch, and worker startup.
2. Run the submission sweep and Temporal workflow integration tests with the repository's required test database setup.
3. Run the submission lifecycle E2E test or the full E2E suite when the local services are available.
4. Run `pnpm ci:verify`.
5. Inspect `git diff`, `git status`, and the final test output; do not claim recovery coverage beyond the scenarios actually exercised.

**Public API:** No submission schema, database migration, task queue, or HTTP response shape changes. The HTTP endpoint continues to return `202 { submissionId, pollUrl, status }` even when the immediate Temporal start is deferred.

**Failure policy:** A committed submission is never converted to `system_error` merely because immediate Temporal dispatch failed. Existing terminal workflow failures and stale orphan recovery remain governed by the current system-error and judge-generation mechanisms.
