import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMembership: vi.fn(),
  findMembershipTx: vi.fn(),
  createCourse: vi.fn(),
  createMembership: vi.fn(),
  findUser: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  courseMembershipRepo: {
    findByComposite: mocks.findMembership,
    withTx: () => ({
      findByComposite: mocks.findMembershipTx,
      create: mocks.createMembership,
    }),
  },
  courseRepo: { withTx: () => ({ create: mocks.createCourse }) },
  userRepo: { withTx: () => ({ findById: mocks.findUser }) },
  runTransaction: mocks.runTransaction,
}));

import {
  ForbiddenError,
  assertCourseManager,
  canCreateCourse,
  courseDomain,
  getCourseRole,
  isCourseManager,
  resolveCourseRole,
} from "@nojv/application";

const teacher = {
  userId: "usr_teacher",
  username: "teacher",
  platformRole: "teacher" as const,
  displayName: "Teacher",
  email: "teacher@example.com",
};
const student = { ...teacher, userId: "usr_student", platformRole: "student" as const };
const admin = { ...teacher, userId: "usr_admin", platformRole: "admin" as const };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.runTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
});

describe("resolveCourseRole", () => {
  it("counts only active memberships", () => {
    expect(resolveCourseRole("teacher", { role: "teacher", status: "active" })).toBe("teacher");
    expect(resolveCourseRole("teacher", { role: "teacher", status: "removed" })).toBeNull();
    expect(resolveCourseRole("student", null)).toBeNull();
  });

  it("lets an effective admin in without a membership", () => {
    expect(resolveCourseRole("admin", undefined)).toBe("admin");
  });
});

describe("isCourseManager", () => {
  it("grants active teachers and TAs", () => {
    expect(isCourseManager("teacher", { role: "teacher", status: "active" })).toBe(true);
    expect(isCourseManager("student", { role: "ta", status: "active" })).toBe(true);
  });

  it("denies students, removed staff and non-members", () => {
    expect(isCourseManager("teacher", { role: "student", status: "active" })).toBe(false);
    expect(isCourseManager("teacher", { role: "ta", status: "removed" })).toBe(false);
    expect(isCourseManager("teacher", null)).toBe(false);
  });
});

describe("getCourseRole and assertCourseManager", () => {
  it("resolves the actor's membership outside a transaction", async () => {
    mocks.findMembership.mockResolvedValue({ role: "ta", status: "active" });
    await expect(getCourseRole(student, "course-1")).resolves.toBe("ta");
    expect(mocks.findMembership).toHaveBeenCalledWith("course-1", student.userId);
  });

  it("reads through the transaction when one is given", async () => {
    mocks.findMembershipTx.mockResolvedValue({ role: "teacher", status: "active" });
    await expect(assertCourseManager(teacher, "course-1", {} as never)).resolves.toBe(
      "teacher",
    );
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("does not read memberships for an effective admin", async () => {
    await expect(assertCourseManager(admin, "course-1")).resolves.toBe("admin");
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("rejects a removed teacher even when they own the course", async () => {
    mocks.findMembership.mockResolvedValue({ role: "teacher", status: "removed" });
    await expect(assertCourseManager(teacher, "course-1")).rejects.toThrow(ForbiddenError);
  });

  it("rejects students and non-members", async () => {
    mocks.findMembership.mockResolvedValueOnce({ role: "student", status: "active" });
    await expect(assertCourseManager(student, "course-1")).rejects.toThrow(ForbiddenError);
    mocks.findMembership.mockResolvedValueOnce(null);
    await expect(assertCourseManager(teacher, "course-1")).rejects.toThrow(ForbiddenError);
  });
});

describe("course creation authority", () => {
  it("allows platform teachers and admins only", () => {
    expect(canCreateCourse("admin")).toBe(true);
    expect(canCreateCourse("teacher")).toBe(true);
    expect(canCreateCourse("student")).toBe(false);
  });

  it("createCourseRecord rejects a student before writing", async () => {
    await expect(
      courseDomain.createCourseRecord(student, { title: "Course", description: "" }),
    ).rejects.toThrow(ForbiddenError);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.createCourse).not.toHaveBeenCalled();
  });

  it("createCourseRecord gives the owner an active teacher membership", async () => {
    mocks.findUser.mockResolvedValue({ id: teacher.userId });
    mocks.createCourse.mockResolvedValue({ id: "course-new" });

    await courseDomain.createCourseRecord(teacher, { title: "Course", description: "" });

    expect(mocks.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: "course-new",
        userId: teacher.userId,
        role: "teacher",
        status: "active",
      }),
    );
  });

  it("copyCourse rejects a course TA without platform course creation rights", async () => {
    mocks.findMembershipTx.mockResolvedValue({ role: "ta", status: "active" });
    await expect(courseDomain.copyCourse(student, "course-1", "Copy")).rejects.toThrow(
      ForbiddenError,
    );
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
});
