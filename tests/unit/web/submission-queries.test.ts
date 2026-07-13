import { beforeEach, describe, expect, it, vi } from "vitest";

const { findByIdForUserRead } = vi.hoisted(() => ({
  findByIdForUserRead: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: {
    findByIdForUserRead,
  },
  assessmentRepo: {
    findByCourseAndId: vi.fn(),
  },
  problemRepo: {
    findById: vi.fn(),
  },
}));

import { NotFoundError, submissionDomain } from "@nojv/application";

const { getSubmissionForActor } = submissionDomain;

const actor = {
  userId: "user_alice",
  username: "alice",
  email: "alice@example.test",
  displayName: "Alice",
  platformRole: "student" as const,
};

describe("getSubmissionForActor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns submission when user owns it", async () => {
    const submission = { id: "sub_1", userId: "user_alice", verdict: "accepted" };
    findByIdForUserRead.mockResolvedValue(submission);

    const result = await getSubmissionForActor(actor, "sub_1");

    expect(result).toEqual(submission);
    expect(findByIdForUserRead).toHaveBeenCalledWith({
      id: "sub_1",
      userId: "user_alice",
      adminRecovery: false,
    });
  });

  it("returns submission when user is admin even if not owner", async () => {
    const submission = { id: "sub_1", userId: "user_bob", verdict: "accepted" };
    findByIdForUserRead.mockResolvedValue(submission);

    const result = await getSubmissionForActor({ ...actor, platformRole: "admin" }, "sub_1");

    expect(result).toEqual(submission);
    expect(findByIdForUserRead).toHaveBeenCalledWith({
      id: "sub_1",
      userId: "user_alice",
      adminRecovery: true,
    });
  });

  it("throws NotFoundError when submission doesn't exist", async () => {
    findByIdForUserRead.mockResolvedValue(null);

    await expect(getSubmissionForActor(actor, "sub_missing")).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when user doesn't own it and is not admin", async () => {
    findByIdForUserRead.mockResolvedValue(null);

    await expect(getSubmissionForActor(actor, "sub_1")).rejects.toThrow(NotFoundError);
  });
});
