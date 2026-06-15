import { describe, expect, it, vi } from "vitest";

const { updateStatusIfIn } = vi.hoisted(() => ({
  updateStatusIfIn: vi.fn().mockResolvedValue({ count: 1 }),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { updateStatusIfIn },
}));

import { submissionDomain } from "@nojv/application";

describe("restoreSubmissionAfterCancelledRejudge", () => {
  it("only restores rows still in an in-flight status so a written verdict is never clobbered", async () => {
    await submissionDomain.restoreSubmissionAfterCancelledRejudge("sub-1", "accepted");

    expect(updateStatusIfIn).toHaveBeenCalledExactlyOnceWith(
      "sub-1",
      ["queued", "running"],
      "accepted",
    );
  });
});
