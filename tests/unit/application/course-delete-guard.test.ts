import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma as RealPrisma } from "../../../packages/db/generated/prisma/client";

const { findById, lockForUpdate, deleteCourseFn, runTransaction } = vi.hoisted(() => ({
  findById: vi.fn(),
  lockForUpdate: vi.fn(),
  deleteCourseFn: vi.fn(),
  runTransaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ $executeRaw: async () => 0 }),
  ),
}));

vi.mock("@nojv/db", () => ({
  courseRepo: { withTx: () => ({ findById, lockForUpdate, delete: deleteCourseFn }) },
  courseMembershipRepo: { withTx: () => ({ findByComposite: vi.fn() }) },
  assessmentRepo: {},
  assessmentProblemRepo: {},
  examProblemRepo: {},
  examRepo: {},
  problemRepo: {},
  runTransaction,
  Prisma: RealPrisma,
}));

import { ConflictError, courseDomain } from "@nojv/application";

const { deleteCourse } = courseDomain;

const admin = {
  userId: "usr_admin",
  username: "admin",
  platformRole: "admin" as const,
  displayName: "Admin",
  email: "admin@example.com",
};

describe("deleteCourse — submission-context Restrict guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findById.mockResolvedValue({ id: "crs_1", title: "Algorithms" });
    lockForUpdate.mockResolvedValue([]);
  });

  it("translates a P2003 FK violation into a clean ConflictError", async () => {
    deleteCourseFn.mockRejectedValue(
      new RealPrisma.PrismaClientKnownRequestError("FK violation", {
        code: "P2003",
        clientVersion: "x",
      }),
    );

    await expect(deleteCourse(admin, "crs_1")).rejects.toBeInstanceOf(ConflictError);
  });

  it("deletes a course with no submissions", async () => {
    deleteCourseFn.mockResolvedValue({ id: "crs_1" });

    await expect(deleteCourse(admin, "crs_1")).resolves.toEqual({ id: "crs_1" });
    expect(lockForUpdate).toHaveBeenCalledWith("crs_1");
  });
});
