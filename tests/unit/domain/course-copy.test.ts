import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  courseFindById,
  courseCreate,
  membershipFindByComposite,
  membershipCreate,
  userFindById,
  userCreate,
  userUpdate,
  assessmentListWithProblems,
  assessmentCreate,
  assessmentProblemCreate,
  examListWithProblems,
  examCreate,
  examProblemCreate,
} = vi.hoisted(() => ({
  courseFindById: vi.fn(),
  courseCreate: vi.fn(),
  membershipFindByComposite: vi.fn(),
  membershipCreate: vi.fn(),
  userFindById: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  assessmentListWithProblems: vi.fn(),
  assessmentCreate: vi.fn(),
  assessmentProblemCreate: vi.fn(),
  examListWithProblems: vi.fn(),
  examCreate: vi.fn(),
  examProblemCreate: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  return {
    courseRepo: {
      withTx: () => ({
        findById: courseFindById,
        create: courseCreate,
        update: vi.fn(),
        delete: vi.fn(),
      }),
    },
    courseMembershipRepo: {
      withTx: () => ({
        findByComposite: membershipFindByComposite,
        create: membershipCreate,
        upsert: vi.fn(),
      }),
    },
    userRepo: {
      withTx: () => ({
        findById: userFindById,
        create: userCreate,
        update: userUpdate,
      }),
    },
    assessmentRepo: {
      withTx: () => ({
        listByCourseIdAllWithProblems: assessmentListWithProblems,
        findByCompositeId: vi.fn(),
        create: assessmentCreate,
      }),
    },
    assessmentProblemRepo: {
      withTx: () => ({
        create: assessmentProblemCreate,
      }),
    },
    examRepo: {
      withTx: () => ({
        findById: vi.fn(),
        listByCourseIdAllWithProblems: examListWithProblems,
        create: examCreate,
        update: vi.fn(),
      }),
    },
    examProblemRepo: {
      withTx: () => ({
        create: examProblemCreate,
        deleteByExamId: vi.fn(),
      }),
    },
    problemRepo: {
      withTx: () => ({}),
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
  };
});

import { ForbiddenError, NotFoundError, courseDomain } from "@nojv/application";

const { copyCourse } = courseDomain;

const teacherActor = {
  userId: "usr_teacher",
  username: "teacher",
  platformRole: "teacher" as const,
  displayName: "Mx Teacher",
  email: "teacher@example.com",
};

const studentActor = {
  userId: "usr_student",
  username: "student",
  platformRole: "student" as const,
  displayName: "Student One",
  email: "student@example.com",
};

const adminActor = {
  userId: "usr_admin",
  username: "admin",
  platformRole: "admin" as const,
  displayName: "Admin",
  email: "admin@example.com",
};

const sourceCourse = {
  id: "course_source",
  title: "Algorithms 101",
  description: "Intro course",
  ownerId: "usr_teacher",
  archived: false,
  createdAt: new Date("2025-09-01T00:00:00Z"),
  updatedAt: new Date("2025-09-01T00:00:00Z"),
};

const assessmentRow = {
  id: "asm_hw1",
  courseId: "course_source",
  title: "Homework 1",
  summary: "First homework",
  status: "published" as const,
  opensAt: new Date("2025-09-05T00:00:00Z"),
  dueAt: new Date("2025-09-12T00:00:00Z"),
  closesAt: new Date("2025-09-14T00:00:00Z"),
  maxAttemptsPerDay: 5,
  allowedLanguages: ["python", "cpp"],
  adjustmentRules: [{ kind: "late_penalty_decay", halfLifeHours: 24 }],
  plagiarismStatus: null,
  problems: [
    { problemId: "prob_a", ordinal: 1, points: 100 },
    { problemId: "prob_b", ordinal: 2, points: 200 },
  ],
};

const examRow = {
  id: "exam_mid",
  courseId: "course_source",
  title: "Midterm",
  summary: "Midterm exam",
  status: "published" as const,
  startsAt: new Date("2025-10-15T09:00:00Z"),
  endsAt: new Date("2025-10-15T12:00:00Z"),
  scoringMode: "point_sum" as const,
  scoreboardMode: "hidden" as const,
  submitCooldownSec: 30,
  allowedLanguages: ["python"],
  pageLockEnabled: true,
  ipWhitelistEnabled: true,
  ipBindingEnabled: false,
  ipWhitelist: ["10.0.0.0/8"],
  ipViolationMode: "block" as const,
  problems: [{ problemId: "prob_c", ordinal: 1, points: 150 }],
};

function primeSuccessPath() {
  courseFindById.mockResolvedValue(sourceCourse);
  membershipFindByComposite.mockResolvedValue({
    userId: teacherActor.userId,
    courseId: sourceCourse.id,
    role: "teacher",
    status: "active",
  });
  userFindById.mockResolvedValue({
    id: teacherActor.userId,
    username: teacherActor.username,
    email: teacherActor.email,
    name: teacherActor.displayName,
    platformRole: teacherActor.platformRole,
  });
  userUpdate.mockResolvedValue({
    id: teacherActor.userId,
    username: teacherActor.username,
    email: teacherActor.email,
    name: teacherActor.displayName,
    platformRole: teacherActor.platformRole,
  });
  courseCreate.mockResolvedValue({ id: "course_new", title: "Algorithms 101 (copy)" });
  membershipCreate.mockResolvedValue(undefined);
  assessmentListWithProblems.mockResolvedValue([assessmentRow]);
  assessmentCreate.mockResolvedValue({ id: "asm_new" });
  assessmentProblemCreate.mockResolvedValue(undefined);
  examListWithProblems.mockResolvedValue([examRow]);
  examCreate.mockResolvedValue({ id: "exam_new" });
  examProblemCreate.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("copyCourse — happy path", () => {
  beforeEach(() => primeSuccessPath());

  it("creates a new course with the suffixed title and returns its id", async () => {
    const result = await copyCourse(teacherActor, sourceCourse.id, "Algorithms 101 (copy)");

    expect(result).toEqual({ newCourseId: "course_new" });
    expect(courseCreate).toHaveBeenCalledTimes(1);
    const newCourse = courseCreate.mock.calls[0][0];
    expect(newCourse.title).toBe("Algorithms 101 (copy)");
    expect(newCourse.description).toBe(sourceCourse.description);
    expect(newCourse.archived).toBeUndefined();
    expect(newCourse.ownerId).toBe(teacherActor.userId);
  });

  it("adds the actor as the sole teacher of the new course", async () => {
    await copyCourse(teacherActor, sourceCourse.id, "Algorithms 101 (copy)");
    expect(membershipCreate).toHaveBeenCalledTimes(1);
    const m = membershipCreate.mock.calls[0][0];
    expect(m.courseId).toBe("course_new");
    expect(m.userId).toBe(teacherActor.userId);
    expect(m.role).toBe("teacher");
    expect(m.status).toBe("active");
  });

  it("clones each assessment with status reset to draft and full field carryover", async () => {
    await copyCourse(teacherActor, sourceCourse.id, "Algorithms 101 (copy)");

    expect(assessmentCreate).toHaveBeenCalledTimes(1);
    const clone = assessmentCreate.mock.calls[0][0];
    expect(clone.courseId).toBe("course_new");
    expect(clone.status).toBe("draft");
    expect(clone.title).toBe(assessmentRow.title);
    expect(clone.summary).toBe(assessmentRow.summary);
    expect(clone.opensAt).toBe(assessmentRow.opensAt);
    expect(clone.dueAt).toBe(assessmentRow.dueAt);
    expect(clone.closesAt).toBe(assessmentRow.closesAt);
    expect(clone.maxAttemptsPerDay).toBe(assessmentRow.maxAttemptsPerDay);
    expect(clone.allowedLanguages).toEqual(assessmentRow.allowedLanguages);
    expect(clone.adjustmentRules).toEqual(assessmentRow.adjustmentRules);
    expect(clone.createdByUserId).toBe(teacherActor.userId);
  });

  it("re-attaches each assessment problem with the same ordinal and points", async () => {
    await copyCourse(teacherActor, sourceCourse.id, "Algorithms 101 (copy)");

    expect(assessmentProblemCreate).toHaveBeenCalledTimes(2);
    const calls = assessmentProblemCreate.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      { assessmentId: "asm_new", ordinal: 1, points: 100, problemId: "prob_a" },
      { assessmentId: "asm_new", ordinal: 2, points: 200, problemId: "prob_b" },
    ]);
  });

  it("clones each exam with status reset to draft and proctoring fields preserved", async () => {
    await copyCourse(teacherActor, sourceCourse.id, "Algorithms 101 (copy)");

    expect(examCreate).toHaveBeenCalledTimes(1);
    const clone = examCreate.mock.calls[0][0];
    expect(clone.courseId).toBe("course_new");
    expect(clone.status).toBe("draft");
    expect(clone.title).toBe(examRow.title);
    expect(clone.summary).toBe(examRow.summary);
    expect(clone.startsAt).toBe(examRow.startsAt);
    expect(clone.endsAt).toBe(examRow.endsAt);
    expect(clone.scoringMode).toBe(examRow.scoringMode);
    expect(clone.scoreboardMode).toBe(examRow.scoreboardMode);
    expect(clone.submitCooldownSec).toBe(examRow.submitCooldownSec);
    expect(clone.allowedLanguages).toEqual(examRow.allowedLanguages);
    expect(clone.pageLockEnabled).toBe(true);
    expect(clone.ipWhitelistEnabled).toBe(true);
    expect(clone.ipBindingEnabled).toBe(false);
    expect(clone.ipWhitelist).toEqual(["10.0.0.0/8"]);
    expect(clone.ipViolationMode).toBe("block");
    expect(clone.createdByUserId).toBe(teacherActor.userId);
  });

  it("re-attaches each exam problem with the same ordinal and points", async () => {
    await copyCourse(teacherActor, sourceCourse.id, "Algorithms 101 (copy)");

    expect(examProblemCreate).toHaveBeenCalledTimes(1);
    const call = examProblemCreate.mock.calls[0][0];
    expect(call).toEqual({ examId: "exam_new", ordinal: 1, points: 150, problemId: "prob_c" });
  });

  it("allows platform admins regardless of course membership", async () => {
    primeSuccessPath();
    membershipFindByComposite.mockResolvedValue(null);
    userFindById.mockResolvedValue({
      id: adminActor.userId,
      username: adminActor.username,
      email: adminActor.email,
      name: adminActor.displayName,
      platformRole: adminActor.platformRole,
    });
    userUpdate.mockResolvedValue({
      id: adminActor.userId,
      username: adminActor.username,
      email: adminActor.email,
      name: adminActor.displayName,
      platformRole: adminActor.platformRole,
    });

    const result = await copyCourse(adminActor, sourceCourse.id, "Algorithms 101 (copy)");
    expect(result.newCourseId).toBe("course_new");
  });
});

describe("copyCourse — authorization", () => {
  it("throws NotFoundError when the source course does not exist", async () => {
    courseFindById.mockResolvedValue(null);
    await expect(
      copyCourse(teacherActor, "course_missing", "Algorithms 101 (copy)"),
    ).rejects.toThrow(NotFoundError);
    expect(courseCreate).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when the caller is a student (not a manager)", async () => {
    courseFindById.mockResolvedValue(sourceCourse);
    membershipFindByComposite.mockResolvedValue({
      userId: studentActor.userId,
      courseId: sourceCourse.id,
      role: "student",
      status: "active",
    });

    await expect(
      copyCourse(studentActor, sourceCourse.id, "Algorithms 101 (copy)"),
    ).rejects.toThrow(ForbiddenError);
    expect(courseCreate).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when the caller has no membership at all", async () => {
    courseFindById.mockResolvedValue(sourceCourse);
    membershipFindByComposite.mockResolvedValue(null);

    await expect(
      copyCourse(studentActor, sourceCourse.id, "Algorithms 101 (copy)"),
    ).rejects.toThrow(ForbiddenError);
    expect(courseCreate).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when the membership is removed (soft-deleted)", async () => {
    courseFindById.mockResolvedValue(sourceCourse);
    membershipFindByComposite.mockResolvedValue({
      userId: teacherActor.userId,
      courseId: sourceCourse.id,
      role: "teacher",
      status: "removed",
    });

    await expect(
      copyCourse(teacherActor, sourceCourse.id, "Algorithms 101 (copy)"),
    ).rejects.toThrow(ForbiddenError);
    expect(courseCreate).not.toHaveBeenCalled();
  });
});

describe("copyCourse — empty source course", () => {
  it("still creates a new course with membership when there are no assessments or exams", async () => {
    primeSuccessPath();
    assessmentListWithProblems.mockResolvedValue([]);
    examListWithProblems.mockResolvedValue([]);

    const result = await copyCourse(teacherActor, sourceCourse.id, "Algorithms 101 (copy)");
    expect(result.newCourseId).toBe("course_new");
    expect(assessmentCreate).not.toHaveBeenCalled();
    expect(assessmentProblemCreate).not.toHaveBeenCalled();
    expect(examCreate).not.toHaveBeenCalled();
    expect(examProblemCreate).not.toHaveBeenCalled();
    expect(membershipCreate).toHaveBeenCalledTimes(1);
  });
});
