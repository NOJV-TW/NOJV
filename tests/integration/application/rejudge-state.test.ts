import { afterEach, describe, expect, it, vi } from "vitest";
import { submissionDomain } from "@nojv/application";
import { durableWorkRepo, Prisma, prismaAdapterClient as db } from "@nojv/db";
import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

const actor = { userId: "requester", platformRole: "teacher" as const };

afterEach(() => vi.unstubAllEnvs());

async function batchRejudge(empty = false) {
  vi.stubEnv("SANDBOX_IMAGE", `sandbox@sha256:${"a".repeat(64)}`);
  const teacher = await createTestUser({ id: actor.userId, platformRole: "teacher" });
  const problem = await createTestProblem({ authorId: teacher.id });
  const submission = empty
    ? null
    : await createTestSubmission({ problemId: problem.id, status: "accepted", score: 100 });
  const operation = await submissionDomain.dispatchRejudge({
    mode: "batch",
    problemId: problem.id,
    triggeredByUserId: teacher.id,
  });
  return { ...operation, submission };
}

describe("rejudge state from durable dispatch", () => {
  it("rejects a single rejudge of a reference solution instead of queuing an empty rejudge", async () => {
    const teacher = await createTestUser({ id: actor.userId, platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });
    const submission = await createTestSubmission({
      problemId: problem.id,
      userId: teacher.id,
      status: "system_error",
      isReferenceSolution: true,
    });
    await expect(
      submissionDomain.dispatchRejudge({
        mode: "single",
        submissionId: submission.id,
        triggeredByUserId: teacher.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.judgeExecution.count({ where: { submissionId: submission.id } })).toBe(0);
  });

  it("completes an empty prepared batch immediately and keeps it completed on cancellation", async () => {
    const { workflowId } = await batchRejudge(true);
    await expect(submissionDomain.queryRejudgeProgress(actor, workflowId)).resolves.toEqual({
      status: "completed",
      completed: 0,
      total: 0,
    });
    expect(await db.judgeExecution.count({ where: { operationId: workflowId } })).toBe(0);
    await expect(submissionDomain.cancelRejudge(actor, workflowId)).resolves.toEqual({
      status: "completed",
    });
    await expect(submissionDomain.queryRejudgeProgress(actor, workflowId)).resolves.toEqual({
      status: "completed",
      completed: 0,
      total: 0,
    });
  });

  it("skips a system error whose upload never stored source instead of failing the batch", async () => {
    vi.stubEnv("SANDBOX_IMAGE", `sandbox@sha256:${"a".repeat(64)}`);
    const teacher = await createTestUser({ id: actor.userId, platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });
    const judged = await createTestSubmission({ problemId: problem.id, status: "accepted" });
    const abandoned = await createTestSubmission({
      problemId: problem.id,
      status: "system_error",
    });
    await db.submission.update({
      where: { id: abandoned.id },
      data: { sourceStorage: Prisma.DbNull },
    });
    const { workflowId } = await submissionDomain.dispatchRejudge({
      mode: "batch",
      problemId: problem.id,
      triggeredByUserId: teacher.id,
    });
    const executions = await db.judgeExecution.findMany({ where: { operationId: workflowId } });
    expect(executions.map((execution) => execution.submissionId)).toEqual([judged.id]);
  });

  it("retrieves queued status and owner from the committed row", async () => {
    const { workflowId } = await batchRejudge();
    await expect(submissionDomain.queryRejudgeProgress(actor, workflowId)).resolves.toEqual({
      status: "queued",
      completed: 0,
      total: 1,
    });
    await expect(
      submissionDomain.queryRejudgeProgress({ ...actor, userId: "other" }, workflowId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("reports a legacy automatic dispatch without a cached result as no longer available", async () => {
    const workflowId = "rejudge-system-error-sub-1-0";
    await durableWorkRepo.enqueue({
      kind: submissionDomain.REJUDGE_DISPATCH_WORK_KIND,
      dedupeKey: "system-error:sub-1:0",
      payload: {
        workflowId,
        input: {
          mode: "single",
          submissionId: "sub-1",
          triggeredByUserId: null,
          expectedJudgeGeneration: 0,
        },
      },
      maxAttempts: 20,
    });
    const admin = { userId: "admin", platformRole: "admin" as const };
    await expect(
      submissionDomain.queryRejudgeProgress(admin, workflowId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(submissionDomain.cancelRejudge(admin, workflowId)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("cancels an unattempted row without allowing it to be claimed", async () => {
    const { workflowId, submission } = await batchRejudge();
    const run = await db.judgeExecution.findFirstOrThrow({
      where: { operationId: workflowId },
    });
    await expect(submissionDomain.cancelRejudge(actor, workflowId)).resolves.toEqual({
      status: "cancelled",
    });
    await expect(
      db.judgeExecution.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({ state: "cancelled" });
    await expect(
      submissionDomain.claimJudgeLease(run.id, run.workflowId, "late-worker"),
    ).resolves.toEqual({ status: "obsolete" });
    await expect(
      db.submission.findUniqueOrThrow({ where: { id: submission!.id } }),
    ).resolves.toMatchObject({
      status: "accepted",
      score: 100,
      activeJudgeRunId: null,
    });
    expect(
      await durableWorkRepo.claimBatch({
        kinds: [submissionDomain.REJUDGE_DISPATCH_WORK_KIND],
        owner: "worker",
        limit: 1,
        now: new Date(),
        leaseDurationMs: 30000,
      }),
    ).toEqual([]);
    await expect(
      submissionDomain.queryRejudgeProgress(actor, workflowId),
    ).resolves.toMatchObject({ status: "cancelled" });
  });
});
