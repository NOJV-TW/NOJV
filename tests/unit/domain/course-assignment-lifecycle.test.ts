import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assessmentCreate,
  courseFindById,
  courseLockForUpdate,
  ensureAssignmentDueSoon,
  membershipFindByComposite,
  userFindById,
  userUpdate,
} = vi.hoisted(() => ({
  assessmentCreate: vi.fn(),
  courseFindById: vi.fn(),
  courseLockForUpdate: vi.fn(),
  ensureAssignmentDueSoon: vi.fn(),
  membershipFindByComposite: vi.fn(),
  userFindById: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  Prisma: {},
  assessmentProblemRepo: { withTx: () => ({ create: vi.fn() }) },
  assessmentRepo: { withTx: () => ({ create: assessmentCreate }) },
  courseMembershipRepo: {
    withTx: () => ({ findByComposite: membershipFindByComposite }),
  },
  courseRepo: {
    withTx: () => ({ findById: courseFindById, lockForUpdate: courseLockForUpdate }),
  },
  examProblemRepo: {},
  examRepo: {},
  problemRepo: { withTx: () => ({ findMany: vi.fn() }) },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
  userRepo: {
    withTx: () => ({ findById: userFindById, update: userUpdate, create: vi.fn() }),
  },
}));

import { configureDomainOrchestration, courseDomain } from "@nojv/application";

const actor = {
  userId: "usr_teacher",
  username: "teacher",
  displayName: "Teacher",
  email: "teacher@example.com",
  platformRole: "teacher" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  courseLockForUpdate.mockResolvedValue([]);
  courseFindById.mockResolvedValue({ id: "course_1" });
  membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
  userFindById.mockResolvedValue({ id: actor.userId });
  userUpdate.mockResolvedValue({ id: actor.userId });
  assessmentCreate.mockResolvedValue({
    id: "assignment_1",
    status: "published",
    opensAt: new Date("2030-01-01T00:00:00.000Z"),
    closesAt: new Date("2030-01-10T00:00:00.000Z"),
    scheduleRevision: 1,
    timerFingerprint: "assessment:v1:assignment_1:window_a",
  });
  configureDomainOrchestration({
    cancelAssignmentDueSoon: vi.fn(),
    cancelContestLifecycle: vi.fn(),
    cancelExamAutoClose: vi.fn(),
    cancelRejudge: vi.fn(),
    describeSubmissionJudge: vi.fn(),
    dispatchPlagiarismCheck: vi.fn(),
    dispatchRegistryGarbageCollect: vi.fn(),
    dispatchRejudge: vi.fn(),
    dispatchSubmissionJudge: vi.fn(),
    ensureAssignmentDueSoon,
    ensureContestLifecycle: vi.fn(),
    ensureExamAutoClose: vi.fn(),
    getRejudgeTriggeredBy: vi.fn(),
    probeTemporal: vi.fn(),
    queryRejudgeProgress: vi.fn(),
    replaceAssignmentDueSoon: vi.fn(),
    replaceContestLifecycle: vi.fn(),
    replaceExamAutoClose: vi.fn(),
    terminateSubmissionJudge: vi.fn(),
  });
});

describe("createCourseAssignmentRecord lifecycle", () => {
  it("locks the course snapshot and ensures a directly published assignment", async () => {
    await courseDomain.createCourseAssignmentRecord(actor, "course_1", {
      courseId: "course_1",
      title: "Published assignment",
      opensAt: "2030-01-01T00:00:00.000Z",
      dueAt: "2030-01-09T00:00:00.000Z",
      closesAt: "2030-01-10T00:00:00.000Z",
      status: "published",
      allowedLanguages: [],
      problemIds: [],
      latePenalty: null,
    });

    expect(courseLockForUpdate).toHaveBeenCalledWith("course_1");
    expect(courseLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      courseFindById.mock.invocationCallOrder[0],
    );
    expect(ensureAssignmentDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "assignment_1",
        scheduleRevision: 1,
        timerFingerprint: "assessment:v1:assignment_1:window_a",
      }),
    );
  });
});
