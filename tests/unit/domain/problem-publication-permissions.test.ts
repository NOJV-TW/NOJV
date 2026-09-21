import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasActiveStaffMembership } = vi.hoisted(() => ({
  hasActiveStaffMembership: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  assessmentProblemRepo: {},
  contestProblemRepo: {},
  courseMembershipRepo: { hasActiveStaffMembership },
  examProblemRepo: {},
  problemRepo: {},
  problemWorkspaceFileRepo: {},
  userRepo: {},
}));

import {
  canPublishPublicProblems,
  canRequestPublicProblemPublication,
} from "../../../packages/application/src/problem/permissions";

describe("canPublishPublicProblems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["admin", "teacher"] as const)("allows platform %s", async (platformRole) => {
    await expect(canPublishPublicProblems({ userId: "usr_staff", platformRole })).resolves.toBe(
      true,
    );
    expect(hasActiveStaffMembership).not.toHaveBeenCalled();
  });

  it("denies a platform student even with an active course staff membership", async () => {
    hasActiveStaffMembership.mockResolvedValue(true);

    await expect(
      canPublishPublicProblems({ userId: "usr_ta", platformRole: "student" }),
    ).resolves.toBe(false);
    expect(hasActiveStaffMembership).not.toHaveBeenCalled();
  });

  it("denies an ordinary student", async () => {
    hasActiveStaffMembership.mockResolvedValue(false);

    await expect(
      canPublishPublicProblems({ userId: "usr_student", platformRole: "student" }),
    ).resolves.toBe(false);
  });

  it("allows an active course staff student to submit a review request", async () => {
    hasActiveStaffMembership.mockResolvedValue(true);
    await expect(
      canRequestPublicProblemPublication({ userId: "usr_ta", platformRole: "student" }),
    ).resolves.toBe(true);
  });

  it("denies review requests from teachers and ordinary students", async () => {
    hasActiveStaffMembership.mockResolvedValue(true);
    await expect(
      canRequestPublicProblemPublication({ userId: "usr_teacher", platformRole: "teacher" }),
    ).resolves.toBe(false);
    hasActiveStaffMembership.mockResolvedValue(false);
    await expect(
      canRequestPublicProblemPublication({ userId: "usr_student", platformRole: "student" }),
    ).resolves.toBe(false);
  });
});
