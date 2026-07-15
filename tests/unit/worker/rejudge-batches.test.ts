import { describe, expect, it, vi } from "vitest";

import {
  executeRejudgeBatches,
  RejudgeBatchError,
} from "../../../apps/worker/src/workflows/rejudge-batches";

describe("rejudge batches", () => {
  it("reports every failed submission and only counts successful children", async () => {
    const completed = vi.fn();
    const failed = vi.fn();
    const targets = ["one", "two", "three", "four"].map((submissionId) => ({ submissionId }));

    const result = executeRejudgeBatches({
      targets,
      batchSize: 2,
      execute: async ({ submissionId }) => {
        if (submissionId === "two" || submissionId === "four") {
          throw new Error(`failed ${submissionId}`);
        }
      },
      isCancellation: () => false,
      onCompleted: completed,
      onFailure: failed,
    });

    await expect(result).rejects.toMatchObject<RejudgeBatchError>({
      name: "RejudgeBatchError",
      failedSubmissionIds: ["two", "four"],
    });
    expect(completed).toHaveBeenCalledTimes(2);
    expect(failed.mock.calls.map(([target]) => target.submissionId)).toEqual(["two", "four"]);
  });

  it("propagates cancellation without converting it into a batch failure", async () => {
    const cancellation = new Error("cancelled");

    await expect(
      executeRejudgeBatches({
        targets: [{ submissionId: "one" }],
        batchSize: 10,
        execute: () => Promise.reject(cancellation),
        isCancellation: (error) => error === cancellation,
        onCompleted: vi.fn(),
        onFailure: vi.fn(),
      }),
    ).rejects.toBe(cancellation);
  });
});
