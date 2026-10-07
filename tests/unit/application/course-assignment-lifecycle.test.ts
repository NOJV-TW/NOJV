vi.mock("../../../packages/application/src/scoring/activity-grading", () => ({
  saveActivityGrading: vi.fn(() => Promise.resolve()),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Db from "@nojv/db";

const {
  assessmentAuditCreate,
  assessmentCreate,
  assessmentProblemFindMany,
  assessmentUpdate,
  courseFindById,
  courseLockForUpdate,
  ensureAssignmentDueSoon,
  membershipFindByComposite,
  userFindById,
  userUpdate,
} = vi.hoisted(() => ({
  assessmentAuditCreate: vi.fn(),
  assessmentCreate: vi.fn(),
  assessmentProblemFindMany: vi.fn(),
  assessmentUpdate: vi.fn(),
  courseFindById: vi.fn(),
  courseLockForUpdate: vi.fn(),
  ensureAssignmentDueSoon: vi.fn(),
  membershipFindByComposite: vi.fn(),
  userFindById: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@nojv/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof Db>()).Prisma,
  assessmentAuditLogRepo: { withTx: () => ({ create: assessmentAuditCreate }) },
  assessmentProblemRepo: { withTx: () => ({ create: vi.fn() }) },
  assessmentRepo: { withTx: () => ({ create: assessmentCreate, update: assessmentUpdate }) },
  courseMembershipRepo: {
    withTx: () => ({ findByComposite: membershipFindByComposite }),
  },
  courseRepo: {
    withTx: () => ({ findById: courseFindById, lockForUpdate: courseLockForUpdate }),
  },
  examProblemRepo: {},
  examRepo: {},
  prismaAdapterClient: { problem: { findUnique: vi.fn(() => Promise.resolve(null)) } },
  problemRepo: { withTx: () => ({ findMany: vi.fn() }) },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ assessmentProblem: { findMany: assessmentProblemFindMany } }),
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
  const draft = {
    id: "assignment_1",
    courseId: "course_1",
    status: "draft",
    allowedLanguages: ["cpp"],
    adjustmentRules: [],
    opensAt: new Date("2030-01-01T00:00:00.000Z"),
    dueAt: new Date("2030-01-09T00:00:00.000Z"),
    closesAt: new Date("2030-01-10T00:00:00.000Z"),
    scheduleRevision: 0,
    timerFingerprint: "assessment:v1:assignment_1:window_a",
  };
  assessmentCreate.mockImplementation((data: Record<string, unknown>) =>
    Promise.resolve({ ...draft, ...data, id: draft.id }),
  );
  assessmentUpdate.mockImplementation((_id: string, data: Record<string, unknown>) =>
    Promise.resolve({ ...draft, ...data, scheduleRevision: 1 }),
  );
  assessmentProblemFindMany.mockResolvedValue([{ problemId: "problem_1", points: 100 }]);
  configureDomainOrchestration({
    cancelAssignmentDueSoon: vi.fn(),
    cancelContestLifecycle: vi.fn(),
    cancelExamAutoClose: vi.fn(),
    describeSubmissionJudge: vi.fn(),
    dispatchPlagiarismCheck: vi.fn(),
    dispatchRegistryGarbageCollect: vi.fn(),
    dispatchJudgeExecution: vi.fn().mockResolvedValue(undefined),
    dispatchJudgeCleanup: vi.fn().mockResolvedValue(undefined),
    ensureAssignmentDueSoon,
    ensureContestLifecycle: vi.fn(),
    ensureExamAutoClose: vi.fn(),
    probeTemporal: vi.fn(),
    replaceAssignmentDueSoon: vi.fn(),
    replaceContestLifecycle: vi.fn(),
    replaceExamAutoClose: vi.fn(),
    terminateSubmissionJudge: vi.fn(),
  });
});

const publishedPayload = {
  courseId: "course_1",
  title: "Published assignment",
  opensAt: "2030-01-01T00:00:00.000Z",
  dueAt: "2030-01-09T00:00:00.000Z",
  closesAt: "2030-01-10T00:00:00.000Z",
  status: "published" as const,
  allowedLanguages: ["cpp" as const],
  allowLateSubmissions: true,
  problems: [{ problemId: "problem_1", points: 100 }],
  latePenalty: null,
};

describe("createCourseAssignmentRecord lifecycle", () => {
  it("publishes through the publish transition and ensures the due-soon reminder", async () => {
    await courseDomain.createCourseAssignmentRecord(actor, "course_1", publishedPayload);

    expect(courseLockForUpdate).toHaveBeenCalledWith("course_1");
    expect(courseLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      courseFindById.mock.invocationCallOrder[0],
    );
    expect(assessmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", summary: "" }),
    );
    expect(assessmentUpdate).toHaveBeenCalledWith("assignment_1", { status: "published" });
    expect(assessmentAuditCreate).toHaveBeenCalledWith({
      assessmentId: "assignment_1",
      courseId: "course_1",
      actorUserId: actor.userId,
      action: "publish",
    });
    expect(ensureAssignmentDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "assignment_1",
        scheduleRevision: 1,
        timerFingerprint: "assessment:v1:assignment_1:window_a",
      }),
    );
  });

  it("creates a draft without publishing or auditing", async () => {
    await courseDomain.createCourseAssignmentRecord(actor, "course_1", {
      ...publishedPayload,
      status: "draft",
      allowedLanguages: [],
      problems: [],
    });

    expect(assessmentCreate).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    expect(assessmentUpdate).not.toHaveBeenCalled();
    expect(assessmentAuditCreate).not.toHaveBeenCalled();
    expect(ensureAssignmentDueSoon).not.toHaveBeenCalled();
  });

  it.each([
    [
      "no allowed language",
      { allowedLanguages: [] },
      "Select at least one allowed language before publishing.",
    ],
    [
      "a final deadline in the past",
      {
        opensAt: "2020-01-01T00:00:00.000Z",
        dueAt: "2020-01-09T00:00:00.000Z",
        closesAt: "2020-01-10T00:00:00.000Z",
      },
      "closesAt must be in the future.",
    ],
  ])("rejects creating as published with %s", async (_label, override, error) => {
    await expect(
      courseDomain.createCourseAssignmentRecord(actor, "course_1", {
        ...publishedPayload,
        ...override,
      }),
    ).rejects.toThrow(error);

    expect(assessmentUpdate).not.toHaveBeenCalled();
    expect(assessmentAuditCreate).not.toHaveBeenCalled();
    expect(ensureAssignmentDueSoon).not.toHaveBeenCalled();
  });
});
