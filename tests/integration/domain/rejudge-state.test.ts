import { describe, expect, it, vi } from "vitest";
import { configureDomainOrchestration, submissionDomain } from "@nojv/application";
import { durableWorkRepo } from "@nojv/db";

const actor = { userId: "requester", platformRole: "teacher" as const };

async function queuedRejudge() {
  return submissionDomain.dispatchRejudge({
    mode: "batch",
    problemId: "problem-1",
    triggeredByUserId: actor.userId,
  });
}

describe("rejudge state from durable dispatch", () => {
  it("retrieves queued status and owner from the committed row while Temporal is unavailable", async () => {
    const queryRejudgeProgress = vi.fn().mockRejectedValue(new Error("Temporal unavailable"));
    configureDomainOrchestration({ queryRejudgeProgress } as unknown as Parameters<
      typeof configureDomainOrchestration
    >[0]);
    const { workflowId } = await queuedRejudge();
    await expect(submissionDomain.queryRejudgeProgress(actor, workflowId)).resolves.toEqual({
      status: "queued",
      completed: 0,
      total: 0,
    });
    await expect(
      submissionDomain.queryRejudgeProgress({ ...actor, userId: "other" }, workflowId),
    ).rejects.toMatchObject({ status: 403 });
    expect(queryRejudgeProgress).not.toHaveBeenCalled();
  });

  it("finds and cancels automatic recovery by workflow identity, independent of dedupe key", async () => {
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
    const { workflowId } = await queuedRejudge();
    await expect(submissionDomain.cancelRejudge(actor, workflowId)).resolves.toEqual({
      status: "cancelled",
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
    const { workflowId } = await queuedRejudge();
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
