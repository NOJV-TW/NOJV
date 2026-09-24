import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindById } = vi.hoisted(() => ({ userFindById: vi.fn() }));

vi.mock("@nojv/db", () => ({
  assessmentProblemRepo: {},
  contestProblemRepo: {},
  courseMembershipRepo: {},
  examProblemRepo: {},
  problemRepo: {},
  problemWorkspaceFileRepo: {},
  userRepo: { findById: userFindById },
}));

import { ForbiddenError, problemDomain } from "@nojv/application";

const { canCreateAdvancedProblems, assertCanCreateAdvancedProblems } = problemDomain;

describe("canCreateAdvancedProblems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows admins without reading the user row", async () => {
    await expect(
      canCreateAdvancedProblems({ userId: "usr_1", platformRole: "admin" }),
    ).resolves.toBe(true);
    expect(userFindById).not.toHaveBeenCalled();
  });

  it("allows a teacher whose flag is granted", async () => {
    userFindById.mockResolvedValue({ canCreateAdvancedProblems: true });
    await expect(
      canCreateAdvancedProblems({ userId: "usr_1", platformRole: "teacher" }),
    ).resolves.toBe(true);
  });

  it("denies a teacher without the flag", async () => {
    userFindById.mockResolvedValue({ canCreateAdvancedProblems: false });
    await expect(
      canCreateAdvancedProblems({ userId: "usr_1", platformRole: "teacher" }),
    ).resolves.toBe(false);
  });

  it("denies when the user row is missing", async () => {
    userFindById.mockResolvedValue(null);
    await expect(
      canCreateAdvancedProblems({ userId: "usr_gone", platformRole: "student" }),
    ).resolves.toBe(false);
  });

  it("assert variant throws ForbiddenError when denied", async () => {
    userFindById.mockResolvedValue({ canCreateAdvancedProblems: false });
    await expect(
      assertCanCreateAdvancedProblems({ userId: "usr_1", platformRole: "student" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
