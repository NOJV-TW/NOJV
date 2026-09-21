import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  patched: vi.fn(),
  reconcileExamCredentials: vi.fn(),
  runDurableWorkBatch: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@temporalio/workflow", () => ({
  patched: mocks.patched,
  log: { error: mocks.logError },
  proxyActivities: () => ({
    reconcileExamCredentials: mocks.reconcileExamCredentials,
    runDurableWorkBatch: mocks.runDurableWorkBatch,
  }),
  continueAsNew: vi.fn(),
}));

import { durableWorkWorkflow } from "../../../apps/worker/src/workflows/durable-work";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.patched.mockReturnValue(true);
  mocks.reconcileExamCredentials.mockResolvedValue({ issued: 0, revoked: 0 });
  mocks.runDurableWorkBatch.mockResolvedValue({
    claimed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    processedKind: null,
  });
});

describe("exam credential reconciliation in durable work", () => {
  it("preserves histories recorded before the credential reconciliation patch", async () => {
    mocks.patched.mockReturnValue(false);
    await durableWorkWorkflow();
    expect(mocks.patched).toHaveBeenCalledWith("exam-credential-reconciliation-v1");
    expect(mocks.reconcileExamCredentials).not.toHaveBeenCalled();
    expect(mocks.runDurableWorkBatch).toHaveBeenCalled();
  });

  it("drains bounded roster batches before delivering queued email", async () => {
    mocks.reconcileExamCredentials.mockResolvedValueOnce({ issued: 100, revoked: 0 });
    await durableWorkWorkflow();
    expect(mocks.reconcileExamCredentials).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileExamCredentials.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.runDurableWorkBatch.mock.invocationCallOrder[0]!,
    );
  });

  it("continues existing outbox work when credential reconciliation fails", async () => {
    mocks.reconcileExamCredentials.mockRejectedValueOnce(
      new Error("sensitive transport context"),
    );
    await expect(durableWorkWorkflow()).resolves.toMatchObject({ claimed: 0 });
    expect(mocks.runDurableWorkBatch).toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith(
      "Exam credential reconciliation failed; the next scheduled run will retry.",
    );
  });
});
