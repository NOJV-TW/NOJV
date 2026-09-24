import { afterEach, describe, expect, it, vi } from "vitest";
import { configureDomainOrchestration, submissionDomain } from "@nojv/application";
import { durableWorkRepo, prismaAdapterClient as db } from "@nojv/db";
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

  it("retrieves queued status and owner from the committed row while Temporal is unavailable", async () => {
    const queryRejudgeProgress = vi.fn().mockRejectedValue(new Error("Temporal unavailable"));
    configureDomainOrchestration({ queryRejudgeProgress } as unknown as Parameters<
      typeof configureDomainOrchestration
    >[0]);
    const { workflowId } = await batchRejudge();
    await expect(submissionDomain.queryRejudgeProgress(actor, workflowId)).resolves.toEqual({
      status: "queued",
      completed: 0,
      total: 1,
    });
    await expect(
      submissionDomain.queryRejudgeProgress({ ...actor, userId: "other" }, workflowId),
    ).rejects.toMatchObject({ status: 403 });
    expect(queryRejudgeProgress).not.toHaveBeenCalled();
  });

  it("finds and cancels a legacy automatic dispatch by workflow identity, independent of dedupe key", async () => {
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
    ).resolves.toMatchObject({ status: "queued" });
    await expect(submissionDomain.cancelRejudge(admin, workflowId)).resolves.toEqual({
      status: "cancelled",
    });
    await expect(
      submissionDomain.queryRejudgeProgress(admin, workflowId),
    ).resolves.toMatchObject({ status: "cancelled" });
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

  it("cannot cancel a dispatch once a worker has claimed it", async () => {
    const { workflowId } = await batchRejudge();
    const key = { kind: submissionDomain.REJUDGE_DISPATCH_WORK_KIND, dedupeKey: workflowId };
    await durableWorkRepo.claimBatch({
      kinds: [key.kind],
      owner: "worker",
      limit: 1,
      now: new Date(),
      leaseDurationMs: 30000,
    });
    await expect(durableWorkRepo.cancelUnattempted({ ...key, now: new Date() })).resolves.toBe(
      false,
    );
    await expect(durableWorkRepo.findByWorkflowId(key.kind, workflowId)).resolves.toMatchObject(
      {
        status: "leased",
        attempt: 1,
      },
    );
  });
});
