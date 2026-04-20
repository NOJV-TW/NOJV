import { beforeEach, describe, expect, it, vi } from "vitest";

const { findById } = vi.hoisted(() => ({
  findById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: {
    findById,
  },
  assessmentRepo: {
    findByCourseAndId: vi.fn(),
  },
  problemRepo: {
    findById: vi.fn(),
  },
}));

import { submissionDomain } from "@nojv/domain";
import { NotFoundError } from "@nojv/domain";

const { getSubmissionForUser } = submissionDomain;

describe("getSubmissionForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns submission when user owns it", async () => {
    const submission = { id: "sub_1", userId: "user_alice", verdict: "accepted" };
    findById.mockResolvedValue(submission);

    const result = await getSubmissionForUser("sub_1", "user_alice", false);

    expect(result).toEqual(submission);
    expect(findById).toHaveBeenCalledWith("sub_1");
  });

  it("returns submission when user is admin even if not owner", async () => {
    const submission = { id: "sub_1", userId: "user_bob", verdict: "accepted" };
    findById.mockResolvedValue(submission);

    const result = await getSubmissionForUser("sub_1", "user_alice", true);

    expect(result).toEqual(submission);
  });

  it("throws NotFoundError when submission doesn't exist", async () => {
    findById.mockResolvedValue(null);

    await expect(getSubmissionForUser("sub_missing", "user_alice", false)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws NotFoundError when user doesn't own it and is not admin", async () => {
    const submission = { id: "sub_1", userId: "user_bob", verdict: "accepted" };
    findById.mockResolvedValue(submission);

    await expect(getSubmissionForUser("sub_1", "user_alice", false)).rejects.toThrow(
      NotFoundError,
    );
  });
});
