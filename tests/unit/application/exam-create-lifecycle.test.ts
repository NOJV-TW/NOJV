vi.mock("../../../packages/application/src/scoring/activity-grading", () => ({
  saveActivityGrading: vi.fn(() => Promise.resolve()),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Db from "@nojv/db";

const {
  courseFindById,
  courseLockForUpdate,
  ensureExamAutoClose,
  examCreate,
  examProblemFindMany,
  examUpdate,
  membershipFindByComposite,
  userFindById,
} = vi.hoisted(() => ({
  courseFindById: vi.fn(),
  courseLockForUpdate: vi.fn(),
  ensureExamAutoClose: vi.fn(),
  examCreate: vi.fn(),
  examProblemFindMany: vi.fn(),
  examUpdate: vi.fn(),
  membershipFindByComposite: vi.fn(),
  userFindById: vi.fn(),
}));

vi.mock("@nojv/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof Db>()).Prisma,
  courseMembershipRepo: {
    withTx: () => ({ findByComposite: membershipFindByComposite }),
  },
  courseRepo: {
    withTx: () => ({ findById: courseFindById, lockForUpdate: courseLockForUpdate }),
  },
  examRepo: { withTx: () => ({ create: examCreate, update: examUpdate }) },
  prismaAdapterClient: { problem: { findUnique: vi.fn(() => Promise.resolve(null)) } },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ examProblem: { findMany: examProblemFindMany } }),
  userRepo: { withTx: () => ({ findById: userFindById }) },
}));

import { configureDomainOrchestration, examDomain } from "@nojv/application";

const actor = {
  userId: "usr_teacher",
  username: "teacher",
  displayName: "Teacher",
  email: "teacher@example.com",
  platformRole: "teacher" as const,
};

const publishedPayload = {
  courseId: "course_1",
  title: "Midterm",
  startsAt: "2030-01-01T00:00:00.000Z",
  endsAt: "2030-01-01T03:00:00.000Z",
  status: "published" as const,
  allowedLanguages: ["cpp" as const],
  problems: [{ problemId: "problem_1", points: 100 }],
  examPasswordEnabled: false,
  ipBindingEnabled: false,
  ipViolationMode: "block" as const,
  ipWhitelist: [],
  ipWhitelistEnabled: false,
  pageLockEnabled: false,
  scoreboardMode: "hidden" as const,
  scoringMode: "point_sum" as const,
  submitCooldownSec: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  courseLockForUpdate.mockResolvedValue([]);
  courseFindById.mockResolvedValue({ id: "course_1", archived: false });
  membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
  userFindById.mockResolvedValue({ id: actor.userId });
  examCreate.mockImplementation((data: Record<string, unknown>) =>
    Promise.resolve({ ...data, id: "exam_1", scheduleRevision: 0 }),
  );
  examUpdate.mockImplementation((_id: string, data: Record<string, unknown>) =>
    Promise.resolve({
      id: "exam_1",
      startsAt: new Date(publishedPayload.startsAt),
      endsAt: new Date(publishedPayload.endsAt),
      ...data,
      scheduleRevision: 1,
    }),
  );
  examProblemFindMany.mockResolvedValue([{ problemId: "problem_1", points: 100 }]);
  configureDomainOrchestration({
    cancelAssignmentDueSoon: vi.fn(),
    cancelContestLifecycle: vi.fn(),
    cancelExamAutoClose: vi.fn(),
    describeSubmissionJudge: vi.fn(),
    dispatchPlagiarismCheck: vi.fn(),
    dispatchRegistryGarbageCollect: vi.fn(),
    dispatchJudgeExecution: vi.fn().mockResolvedValue(undefined),
    dispatchJudgeCleanup: vi.fn().mockResolvedValue(undefined),
    dispatchTestJudgeProgramBuild: vi.fn().mockResolvedValue(undefined),
    ensureAssignmentDueSoon: vi.fn(),
    ensureContestLifecycle: vi.fn(),
    ensureExamAutoClose,
    probeTemporal: vi.fn(),
    replaceAssignmentDueSoon: vi.fn(),
    replaceContestLifecycle: vi.fn(),
    replaceExamAutoClose: vi.fn(),
    runTestJudge: vi.fn(),
    terminateSubmissionJudge: vi.fn(),
  });
});

describe("createExamRecord lifecycle", () => {
  it("publishes through the publish transition and ensures auto-close", async () => {
    await examDomain.createExamRecord(actor, publishedPayload);

    expect(examCreate).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    expect(examUpdate).toHaveBeenCalledWith("exam_1", { status: "published" });
    expect(ensureExamAutoClose).toHaveBeenCalledWith(
      expect.objectContaining({ examId: "exam_1", scheduleRevision: 1 }),
    );
  });

  it.each([
    [
      "no allowed language",
      { allowedLanguages: [] },
      "Select at least one allowed language before publishing.",
    ],
    [
      "an end time in the past",
      { startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2020-01-01T03:00:00.000Z" },
      "End time must be in the future.",
    ],
  ])("rejects creating as published with %s", async (_label, override, error) => {
    await expect(
      examDomain.createExamRecord(actor, { ...publishedPayload, ...override }),
    ).rejects.toThrow(error);

    expect(examUpdate).not.toHaveBeenCalled();
    expect(ensureExamAutoClose).not.toHaveBeenCalled();
  });
});
