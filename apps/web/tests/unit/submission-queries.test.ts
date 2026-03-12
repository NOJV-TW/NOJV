import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueSubmission } = vi.hoisted(() => ({
  findUniqueSubmission: vi.fn()
}));

vi.mock("@nojv/db", () => ({
  prisma: {
    submission: {
      findUnique: findUniqueSubmission
    }
  }
}));

import { getSubmissionForUser } from "$lib/server/submission/queries";
import { NotFoundError } from "$lib/server/auth";

describe("getSubmissionForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns submission when user owns it", async () => {
    const submission = { id: "sub_1", userId: "user_alice", verdict: "accepted" };
    findUniqueSubmission.mockResolvedValue(submission);

    const result = await getSubmissionForUser("sub_1", "user_alice", false);

    expect(result).toEqual(submission);
    expect(findUniqueSubmission).toHaveBeenCalledWith({ where: { id: "sub_1" } });
  });

  it("returns submission when user is admin even if not owner", async () => {
    const submission = { id: "sub_1", userId: "user_bob", verdict: "accepted" };
    findUniqueSubmission.mockResolvedValue(submission);

    const result = await getSubmissionForUser("sub_1", "user_alice", true);

    expect(result).toEqual(submission);
  });

  it("throws NotFoundError when submission doesn't exist", async () => {
    findUniqueSubmission.mockResolvedValue(null);

    await expect(getSubmissionForUser("sub_missing", "user_alice", false)).rejects.toThrow(
      NotFoundError
    );
  });

  it("throws NotFoundError when user doesn't own it and is not admin", async () => {
    const submission = { id: "sub_1", userId: "user_bob", verdict: "accepted" };
    findUniqueSubmission.mockResolvedValue(submission);

    await expect(getSubmissionForUser("sub_1", "user_alice", false)).rejects.toThrow(
      NotFoundError
    );
  });
});
