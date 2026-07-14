import { describe, expect, it, vi } from "vitest";

const { updateMany } = vi.hoisted(() => ({
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: {},
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ submission: { updateMany } }),
}));

import { restoreSubmissionAfterCancelledRejudge } from "../../../packages/application/src/submission/mutations";

describe("restoreSubmissionAfterCancelledRejudge", () => {
  it("only restores rows still in an in-flight status so a written verdict is never clobbered", async () => {
    await restoreSubmissionAfterCancelledRejudge("sub-1", "run-1", "accepted");

    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: "sub-1",
        activeJudgeRunId: "run-1",
        status: { in: ["queued", "running"] },
      },
      data: { activeJudgeRunId: null, status: "accepted" },
    });
  });
});
