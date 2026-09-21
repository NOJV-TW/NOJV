import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  submissionDomain as judge,
  problemDomain,
  configureDomainOrchestration,
} from "@nojv/application";
import { prismaAdapterClient as db, runTransaction, submissionRejudgeLogRepo } from "@nojv/db";
import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

beforeEach(() => {
  process.env.SANDBOX_IMAGE = "sandbox@sha256:" + "a".repeat(64);
});
async function fixture() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const user = await createTestUser();
  const problem = await createTestProblem({ authorId: teacher.id });
  const submission = await createTestSubmission({
    userId: user.id,
    problemId: problem.id,
    status: "queued",
  });
  const draft = { problemId: problem.id, language: submission.language, sampleOnly: false };
  const pinned = await judge.prepareJudgeSnapshot(submission.id, draft);
  const execution = await runTransaction((tx) =>
    judge.createJudgeExecution(tx, { submissionId: submission.id, ...pinned }),
  );
  return { teacher, user, problem, submission, execution, draft };
}
const ac = {
  feedback: "Accepted",
  accepted: true,
  verdict: "accepted" as const,
  score: 100,
  runtimeMs: 1,
  caseResults: [],
};

describe("immutable judge execution recovery", () => {
  it("acknowledges durable acceptance even while Temporal dispatch remains unavailable", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const user = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const dispatchJudgeExecution = vi.fn(() => new Promise<void>(() => undefined));
    configureDomainOrchestration({ dispatchJudgeExecution } as never);
    const accepted = await judge.submitAndDispatch(
      {
        problemId: problem.id,
        language: "python",
        sourceCode: "print(3)",
        context: { type: "practice" },
      },
      {
        userId: user.id,
        username: user.username ?? "student",
        displayName: user.name,
        email: user.email,
        platformRole: "student",
      },
      "127.0.0.1",
    );
    const submission = await db.submission.findUniqueOrThrow({ where: { id: accepted.id } });
    const execution = await db.judgeExecution.findFirstOrThrow({
      where: { submissionId: accepted.id },
    });
    expect(submission).toMatchObject({
      status: "queued",
      judgeGeneration: 1,
      activeJudgeRunId: execution.workflowId,
    });
    expect(submission.sourceStorage).not.toBeNull();
    expect(
      await db.durableWork.findUnique({
        where: {
          kind_dedupeKey: {
            kind: "submission.execution.dispatch",
            dedupeKey: execution.workflowId,
          },
        },
      }),
    ).toMatchObject({ status: "pending" });
    expect((await judge.loadJudgeExecution(execution.id)).snapshot.sources).toEqual([
      { path: "main.py", content: "print(3)" },
    ]);
  });

  it("pins the original problem across edits and selects new content only for teacher rejudge", async () => {
    const { problem, submission, execution, teacher } = await fixture();
    await db.problem.update({
      where: { id: problem.id },
      data: { timeLimitMs: 2000, storageGeneration: { increment: 1 } },
    });
    expect(
      (await judge.loadJudgeExecution(execution.id)).snapshot.context.runtime.timeLimitMs,
    ).toBe(1000);
    await judge.setJudgeExecutionState(
      execution.id,
      execution.workflowId,
      "recovering",
      "machine_failure",
    );
    const operation = await judge.dispatchRejudge({
      mode: "single",
      submissionId: submission.id,
      triggeredByUserId: teacher.id,
    });
    const next = await db.judgeExecution.findFirstOrThrow({
      where: { operationId: operation.workflowId },
    });
    const pinned = await judge.loadJudgeExecution(next.id);
    expect(pinned.snapshot.context.runtime.timeLimitMs).toBe(2000);
    expect(next.generation).toBe(execution.generation + 1);
    expect(
      (await db.judgeExecution.findUniqueOrThrow({ where: { id: execution.id } })).state,
    ).toBe("cancelled");
  });

  it("recovers a terminated workflow using the same snapshot and generation without teacher logs", async () => {
    const { execution } = await fixture();
    configureDomainOrchestration({
      describeSubmissionJudge: vi.fn().mockResolvedValue({ running: false, status: "FAILED" }),
    } as never);
    await judge.reconcileJudgeExecutions(new Date(Date.now() + 1000));
    const recovered = await db.judgeExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(recovered.snapshot).toEqual(execution.snapshot);
    expect(recovered.generation).toBe(execution.generation);
    expect(recovered.workflowId).not.toBe(execution.workflowId);
    expect(recovered.recoveryEpoch).toBe(1);
    expect(recovered.queueClass).toBe("background");
    expect(await db.submissionRejudgeLog.count()).toBe(0);
  });

  it("persists a stage and rejects stale owners after a teacher creates a replacement", async () => {
    const { execution, submission, teacher } = await fixture();
    const claimed = await judge.claimJudgeStage(
      execution.id,
      execution.workflowId,
      1,
      "worker",
    );
    expect(claimed.status).toBe("claimed");
    if (claimed.status !== "claimed") throw new Error("not claimed");
    await judge.setJudgeExecutionState(execution.id, execution.workflowId, "recovering");
    await judge.dispatchRejudge({
      mode: "single",
      submissionId: submission.id,
      triggeredByUserId: teacher.id,
    });
    await expect(
      judge.saveJudgeStage(
        execution.id,
        execution.workflowId,
        0,
        { testcaseResults: [] },
        claimed.leaseToken,
      ),
    ).rejects.toThrow("no longer owns");
    expect(await db.judgeStage.count()).toBe(0);
    expect(
      await judge.heartbeatJudgeStage(execution.id, execution.workflowId, claimed.leaseToken),
    ).toBe(false);
  });

  it("does not resurrect an execution cancelled while admission is claiming its row", async () => {
    const { execution } = await fixture();
    let unlock!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const cancellation = db.$transaction(
      async (tx) => {
        await tx.judgeExecution.update({
          where: { id: execution.id },
          data: { state: "cancelled" },
        });
        locked();
        await released;
      },
      { timeout: 10000 },
    );
    await held;
    const claim = judge.claimJudgeStage(execution.id, execution.workflowId, 1, "worker");
    void claim.catch(() => undefined);
    try {
      await expect
        .poll(
          async () => {
            const rows = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
              AND query LIKE '%UPDATE%JudgeExecution%') AS waiting`;
            return rows[0]?.waiting;
          },
          { timeout: 3000 },
        )
        .toBe(true);
    } finally {
      unlock();
      await cancellation;
    }
    await expect(claim).resolves.toEqual({ status: "obsolete" });
    expect(await db.judgeExecution.findUnique({ where: { id: execution.id } })).toMatchObject({
      state: "cancelled",
      leaseToken: null,
    });
    expect(await db.judgeAdmission.findUnique({ where: { id: "sandbox" } })).toMatchObject({
      cursor: 0,
    });
  });

  it("preserves the valid score during rejudge, supports cancel, and blocks late result writes", async () => {
    const { execution, submission, teacher } = await fixture();
    await judge.setJudgeExecutionState(execution.id, execution.workflowId, "running");
    await judge.completeJudgeExecution(execution.id, execution.workflowId, ac);
    await judge.finishJudgeExecution(execution.id, execution.workflowId);
    const operation = await judge.dispatchRejudge({
      mode: "single",
      submissionId: submission.id,
      triggeredByUserId: teacher.id,
    });
    const next = await db.judgeExecution.findFirstOrThrow({
      where: { operationId: operation.workflowId },
    });
    expect(await db.submission.findUnique({ where: { id: submission.id } })).toMatchObject({
      status: "accepted",
      score: 100,
    });
    await judge.setJudgeExecutionState(
      next.id,
      next.workflowId,
      "recovering",
      "machine_failure",
    );
    expect(await db.submission.findUnique({ where: { id: submission.id } })).toMatchObject({
      status: "accepted",
      score: 100,
    });
    await judge.cancelRejudge(
      { userId: teacher.id, platformRole: "teacher" },
      operation.workflowId,
    );
    await expect(
      judge.completeJudgeExecution(next.id, next.workflowId, { ...ac, score: 0 }),
    ).resolves.toBeNull();
    expect(await db.submission.findUnique({ where: { id: submission.id } })).toMatchObject({
      status: "accepted",
      score: 100,
      activeJudgeRunId: null,
    });
  });

  it("recovers finalization after verdict commit without losing score convergence", async () => {
    const { execution, submission } = await fixture();
    await judge.setJudgeExecutionState(execution.id, execution.workflowId, "running");
    await judge.completeJudgeExecution(execution.id, execution.workflowId, ac);
    await judge.setJudgeExecutionState(execution.id, execution.workflowId, "finalizing");
    configureDomainOrchestration({
      describeSubmissionJudge: vi.fn().mockResolvedValue({ running: false, status: "FAILED" }),
    } as never);
    await judge.reconcileJudgeExecutions(new Date(Date.now() + 1000));
    const recovered = await db.judgeExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    const result = await judge.completeJudgeExecution(recovered.id, recovered.workflowId, ac);
    expect(result).toMatchObject({ id: submission.id, status: "accepted", score: 100 });
    expect(recovered.state).toBe("finalizing");
    await judge.setJudgeExecutionState(
      recovered.id,
      recovered.workflowId,
      "recovering",
      "journal_unavailable",
    );
    expect(await db.judgeExecution.findUnique({ where: { id: recovered.id } })).toMatchObject({
      state: "finalizing",
    });
  });
  it("keeps an already committed teacher result finalizing when cancellation arrives", async () => {
    const { execution, submission, teacher } = await fixture();
    await judge.completeJudgeExecution(execution.id, execution.workflowId, ac);
    await judge.finishJudgeExecution(execution.id, execution.workflowId);
    const operation = await judge.dispatchRejudge({
      mode: "single",
      submissionId: submission.id,
      triggeredByUserId: teacher.id,
    });
    const next = await db.judgeExecution.findFirstOrThrow({
      where: { operationId: operation.workflowId },
    });
    await judge.setJudgeExecutionState(next.id, next.workflowId, "finalizing");
    await judge.completeJudgeExecution(next.id, next.workflowId, { ...ac, score: 75 });
    expect(
      await judge.cancelRejudge(
        { userId: teacher.id, platformRole: "teacher" },
        operation.workflowId,
      ),
    ).toEqual({ status: "requested" });
    expect(await db.judgeExecution.findUnique({ where: { id: next.id } })).toMatchObject({
      state: "finalizing",
    });
    await expect(
      judge.dispatchRejudge({
        mode: "single",
        submissionId: submission.id,
        triggeredByUserId: teacher.id,
      }),
    ).rejects.toThrow("still being finalized");
    expect(
      await judge.completeJudgeExecution(next.id, next.workflowId, { ...ac, score: 75 }),
    ).toMatchObject({ score: 75 });
    await judge.finishJudgeExecution(next.id, next.workflowId);
    expect(
      await judge.queryRejudgeProgress(
        { userId: teacher.id, platformRole: "teacher" },
        operation.workflowId,
      ),
    ).toMatchObject({ status: "completed" });
  });

  it("retains cancelled expired leases until the dedicated cleanup workflow confirms removal", async () => {
    const { execution } = await fixture();
    const claim = await judge.claimJudgeStage(execution.id, execution.workflowId, 1, "worker");
    if (claim.status !== "claimed") throw new Error("not claimed");
    await db.judgeExecution.update({
      where: { id: execution.id },
      data: { state: "cancelled", leaseUntil: new Date(0) },
    });
    const dispatchJudgeCleanup = vi.fn().mockResolvedValue(undefined);
    configureDomainOrchestration({ dispatchJudgeCleanup } as never);
    await judge.reconcileJudgeExecutions();
    expect(dispatchJudgeCleanup).toHaveBeenCalledWith({
      executionId: execution.id,
      workflowId: execution.workflowId,
      leaseToken: claim.leaseToken,
    });
    expect(await db.judgeExecution.findUnique({ where: { id: execution.id } })).toMatchObject({
      leaseToken: claim.leaseToken,
    });
    await judge.releaseJudgeStage(execution.id, execution.workflowId, claim.leaseToken);
    expect(await db.judgeExecution.findUnique({ where: { id: execution.id } })).toMatchObject({
      leaseToken: null,
    });
  });

  it("commits terminal checkpoints atomically so restart cannot rerun a compile error", async () => {
    const { execution } = await fixture();
    const claim = await judge.claimJudgeStage(execution.id, execution.workflowId, 1, "worker");
    if (claim.status !== "claimed") throw new Error("not claimed");
    await judge.saveJudgeStage(
      execution.id,
      execution.workflowId,
      0,
      { compilationError: "syntax error", testcaseResults: [] },
      claim.leaseToken,
      true,
    );
    expect(await db.judgeExecution.findUnique({ where: { id: execution.id } })).toMatchObject({
      state: "finalizing",
      leaseToken: null,
    });
    expect(await judge.readJudgeStages(execution.id)).toEqual([
      { compilationError: "syntax error", testcaseResults: [] },
    ]);
  });

  it("admits both classes in 4:1 order, keeps FIFO, and borrows idle capacity", async () => {
    const runs = [];
    for (let i = 0; i < 7; i++) {
      const { execution } = await fixture();
      await db.judgeExecution.update({
        where: { id: execution.id },
        data: {
          queueClass: i < 5 ? "foreground" : "background",
          queuedAt: new Date(i),
          nextAttemptAt: new Date(0),
        },
      });
      runs.push(execution);
    }
    for (const index of [0, 1, 2, 3, 5, 4, 6]) {
      const expected = runs[index]!;
      for (const other of runs.filter((run) => run.id !== expected.id)) {
        expect(
          (await judge.claimJudgeStage(other.id, other.workflowId, 1, "worker")).status,
        ).not.toBe("claimed");
      }
      const claim = await judge.claimJudgeStage(expected.id, expected.workflowId, 1, "worker");
      expect(claim.status).toBe("claimed");
      await judge.finishJudgeExecution(expected.id, expected.workflowId);
    }
  });

  it("terminates an actually stalled workflow task but preserves healthy waiting workflows", async () => {
    const { execution } = await fixture();
    const terminateSubmissionJudge = vi.fn().mockResolvedValue(undefined);
    const describeSubmissionJudge = vi.fn().mockResolvedValue({
      running: true,
      status: "RUNNING",
      pendingWorkflowTaskAt: new Date(0),
    });
    configureDomainOrchestration({
      describeSubmissionJudge,
      terminateSubmissionJudge,
    } as never);
    await judge.reconcileJudgeExecutions(new Date(Date.now() + 1000));
    expect(terminateSubmissionJudge).toHaveBeenCalledWith(
      execution.submissionId,
      expect.any(String),
      execution.workflowId,
    );
    terminateSubmissionJudge.mockClear();
    describeSubmissionJudge.mockResolvedValue({ running: true, status: "RUNNING" });
    await judge.reconcileJudgeExecutions(new Date(Date.now() + 120_000));
    expect(terminateSubmissionJudge).not.toHaveBeenCalled();
  });
  it("preserves recoverable teacher logs past the retention cutoff", async () => {
    const { execution, submission, teacher } = await fixture();
    await judge.completeJudgeExecution(execution.id, execution.workflowId, ac);
    await judge.finishJudgeExecution(execution.id, execution.workflowId);
    const operation = await judge.dispatchRejudge({
      mode: "single",
      submissionId: submission.id,
      triggeredByUserId: teacher.id,
    });
    const run = await db.judgeExecution.findFirstOrThrow({
      where: { operationId: operation.workflowId },
    });
    await db.submissionRejudgeLog.update({
      where: { id: run.rejudgeLogId! },
      data: { createdAt: new Date(0) },
    });
    expect(await submissionRejudgeLogRepo.deleteOlderThan(new Date())).toEqual({ count: 0 });
    await judge.completeJudgeExecution(run.id, run.workflowId, ac);
    await judge.finishJudgeExecution(run.id, run.workflowId);
    expect(await submissionRejudgeLogRepo.deleteOlderThan(new Date())).toEqual({ count: 1 });
  });

  it("rejects a snapshot whose Advanced configuration changed before acceptance", async () => {
    const admin = await createTestUser({ platformRole: "admin" });
    const digest = "sha256:" + "a".repeat(64);
    const config = {
      run: { imageRef: `ghcr.io/nojv-tw/run@${digest}`, imageSource: "registry" as const },
      grade: { imageRef: `ghcr.io/nojv-tw/grade@${digest}`, imageSource: "registry" as const },
      network: { mode: "none" as const },
      maxScore: 100,
    };
    const problem = await createTestProblem({
      authorId: admin.id,
      status: "draft",
      type: "special_env",
      advancedConfig: config,
    });
    const submission = await createTestSubmission({
      userId: admin.id,
      problemId: problem.id,
      status: "queued",
    });
    const pinned = await judge.prepareJudgeSnapshot(submission.id, {
      problemId: problem.id,
      language: submission.language,
      sampleOnly: false,
    });
    await problemDomain.updateAdvancedJudgeConfiguration(
      { userId: admin.id, username: admin.username ?? "admin", platformRole: "admin" },
      problem.id,
      { config, requiredPaths: ["src/main.c"] },
    );
    expect(await db.problem.findUnique({ where: { id: problem.id } })).toMatchObject({
      storageGeneration: problem.storageGeneration + 1,
      referenceSolutionSubmissionId: null,
    });
    await expect(
      runTransaction((tx) =>
        judge.createJudgeExecution(tx, { submissionId: submission.id, ...pinned }),
      ),
    ).rejects.toThrow("changed before judge acceptance");
  });

  it("keeps active executions during deletion and queues snapshot cleanup after completion", async () => {
    const { execution, submission, problem, teacher } = await fixture();
    await db.problem.update({ where: { id: problem.id }, data: { status: "draft" } });
    await db.submission.update({
      where: { id: submission.id },
      data: {
        isReferenceSolution: true,
        referenceProblemStorageGeneration: problem.storageGeneration,
      },
    });
    const actor = {
      userId: teacher.id,
      username: teacher.username ?? "teacher",
      platformRole: "teacher" as const,
    };
    await expect(problemDomain.deleteProblemRecord(actor, problem.id)).rejects.toThrow();
    await judge.completeJudgeExecution(execution.id, execution.workflowId, ac);
    await judge.finishJudgeExecution(execution.id, execution.workflowId);
    await problemDomain.deleteProblemRecord(actor, problem.id);
    expect(await db.submission.findUnique({ where: { id: submission.id } })).toBeNull();
    const cleanup = await db.durableWork.findMany({
      where: { kind: "storage.object.cleanup", status: "pending" },
    });
    expect(cleanup.map((work) => work.payload)).toContainEqual({ pointer: execution.snapshot });
  });
});
