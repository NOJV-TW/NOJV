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

import { canPublishPublicProblems } from "../../../packages/application/src/problem/permissions";

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

  it("allows a student with an active course TA membership", async () => {
    hasActiveStaffMembership.mockResolvedValue(true);

    await expect(
      canPublishPublicProblems({ userId: "usr_ta", platformRole: "student" }),
    ).resolves.toBe(true);
  });

  it("denies an ordinary student", async () => {
    hasActiveStaffMembership.mockResolvedValue(false);

    await expect(
      canPublishPublicProblems({ userId: "usr_student", platformRole: "student" }),
    ).resolves.toBe(false);
  });
});
