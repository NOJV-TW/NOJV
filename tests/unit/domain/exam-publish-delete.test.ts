import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindById,
  examLockForUpdate,
  examUpdate,
  examDelete,
  examProblemCount,
  membershipFindByComposite,
  ensureExamAutoClose,
  replaceExamAutoClose,
  cancelExamAutoClose,
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  examLockForUpdate: vi.fn(),
  examUpdate: vi.fn(),
  examDelete: vi.fn(),
  examProblemCount: vi.fn(),
  membershipFindByComposite: vi.fn(),
  ensureExamAutoClose: vi.fn(),
  replaceExamAutoClose: vi.fn(),
  cancelExamAutoClose: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  return {
    examRepo: {
      withTx: () => ({
        findById: examFindById,
        lockForUpdate: examLockForUpdate,
        update: examUpdate,
        delete: examDelete,
      }),
      update: examUpdate,
    },
    examProblemRepo: {
      withTx: () => ({
        countByExamId: examProblemCount,
        create: vi.fn(),
        deleteByExamId: vi.fn(),
      }),
      findByExamId: vi.fn(),
      countByExamId: examProblemCount,
    },
    problemRepo: {
      withTx: () => ({ findMany: vi.fn() }),
    },
    submissionRepo: {
      withTx: () => ({ findMostRecent: vi.fn() }),
    },
    courseMembershipRepo: {
      withTx: () => ({ findByComposite: membershipFindByComposite }),
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
  };
});

import {
  configureDomainOrchestration,
  examDomain,
  ForbiddenError,
  ValidationError,
} from "@nojv/application";

const { publishExam, deleteExamDraft, updateExamRecord } = examDomain;

const fakeActor = {
  userId: "usr_teacher",
  username: "teacher",
  displayName: "Teacher One",
  email: "teacher@example.com",
  platformRole: "teacher" as const,
};

const fakeOtherActor = {
  userId: "usr_outsider",
  username: "outsider",
  displayName: "Outsider",
  email: "outsider@example.com",
  platformRole: "student" as const,
};

function publishableExam(overrides: Record<string, unknown> = {}) {
  return {
    id: "exam_1",
    courseId: "course_1",
    createdByUserId: fakeActor.userId,
    status: "draft",
    startsAt: new Date(Date.now() + 60 * 60_000),
    endsAt: new Date(Date.now() + 120 * 60_000),
    allowedLanguages: ["cpp17"],
    scheduleRevision: 1,
    timerFingerprint: "exam:v1:exam_1:window_a",
    ...overrides,
  };
}

beforeEach(() => {
  configureDomainOrchestration({
    cancelAssignmentDueSoon: vi.fn(async () => {}),
    cancelContestLifecycle: vi.fn(async () => {}),
    cancelExamAutoClose,
    cancelRejudge: vi.fn(async () => {}),
    describeSubmissionJudge: vi.fn(async () => null),
    dispatchPlagiarismCheck: vi.fn(async () => {}),
    dispatchRegistryGarbageCollect: vi.fn(async () => ({
      workflowId: "registry-gc",
      alreadyRunning: false,
    })),
    dispatchRejudge: vi.fn(async () => ({ workflowId: "rejudge-test" })),
    dispatchSubmissionJudge: vi.fn(async () => {}),
    ensureAssignmentDueSoon: vi.fn(async () => {}),
    ensureContestLifecycle: vi.fn(async () => {}),
    ensureExamAutoClose,
    getRejudgeTriggeredBy: vi.fn(async () => null),
    probeTemporal: vi.fn(async () => {}),
    queryRejudgeProgress: vi.fn(async () => ({ completed: 0, total: 0 })),
    replaceAssignmentDueSoon: vi.fn(async () => {}),
    replaceContestLifecycle: vi.fn(async () => {}),
    replaceExamAutoClose,
    terminateSubmissionJudge: vi.fn(async () => {}),
  });
});

describe("publishExam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    examLockForUpdate.mockResolvedValue([]);
    examUpdate.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...publishableExam(),
      ...data,
      scheduleRevision: 2,
    }));
  });

  it("publishes a valid draft, updates status, and schedules auto-close", async () => {
    examFindById.mockResolvedValue(publishableExam());
    examProblemCount.mockResolvedValue(1);

    await publishExam(fakeActor, "exam_1");

    expect(examLockForUpdate).toHaveBeenCalledWith("exam_1");
    expect(examLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      examFindById.mock.invocationCallOrder[0],
    );
    expect(examUpdate).toHaveBeenCalledWith("exam_1", { status: "published" });
    expect(ensureExamAutoClose).toHaveBeenCalledTimes(1);
    const [payload] = ensureExamAutoClose.mock.calls[0] as [
      { examId: string; startsAt: string; endsAt: string },
    ];
    expect(payload.examId).toBe("exam_1");
    expect(typeof payload.startsAt).toBe("string");
    expect(typeof payload.endsAt).toBe("string");
  });

  it("rejects when the exam has no attached problems", async () => {
    examFindById.mockResolvedValue(publishableExam());
    examProblemCount.mockResolvedValue(0);

    await expect(publishExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
    expect(examUpdate).not.toHaveBeenCalled();
    expect(ensureExamAutoClose).not.toHaveBeenCalled();
  });

  it("rejects when allowedLanguages is empty", async () => {
    examFindById.mockResolvedValue(publishableExam({ allowedLanguages: [] }));
    examProblemCount.mockResolvedValue(2);

    await expect(publishExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
    expect(examUpdate).not.toHaveBeenCalled();
  });

  it("rejects when startsAt >= endsAt", async () => {
    const now = new Date();
    examFindById.mockResolvedValue(publishableExam({ startsAt: now, endsAt: now }));
    examProblemCount.mockResolvedValue(1);

    await expect(publishExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects when endsAt is in the past", async () => {
    examFindById.mockResolvedValue(
      publishableExam({
        startsAt: new Date(Date.now() - 120 * 60_000),
        endsAt: new Date(Date.now() - 60 * 60_000),
      }),
    );
    examProblemCount.mockResolvedValue(1);

    await expect(publishExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects when the exam is not a draft", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));
    examProblemCount.mockResolvedValue(1);

    await expect(publishExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
    expect(examUpdate).not.toHaveBeenCalled();
    expect(ensureExamAutoClose).not.toHaveBeenCalled();
  });

  it("rejects when the actor is not the creator and not course staff", async () => {
    examFindById.mockResolvedValue(publishableExam());
    membershipFindByComposite.mockResolvedValue(null);

    await expect(publishExam(fakeOtherActor, "exam_1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(examUpdate).not.toHaveBeenCalled();
  });

  it("allows course teachers who did not create the exam", async () => {
    examFindById.mockResolvedValue(publishableExam({ createdByUserId: "somebody_else" }));
    membershipFindByComposite.mockResolvedValue({
      courseId: "course_1",
      userId: fakeActor.userId,
      status: "active",
      role: "teacher",
    });
    examProblemCount.mockResolvedValue(1);

    await publishExam(fakeActor, "exam_1");

    expect(examUpdate).toHaveBeenCalledWith("exam_1", { status: "published" });
  });
});

describe("deleteExamDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a draft exam", async () => {
    examFindById.mockResolvedValue(publishableExam());

    await deleteExamDraft(fakeActor, "exam_1");

    expect(examDelete).toHaveBeenCalledWith("exam_1");
    expect(examLockForUpdate).toHaveBeenCalledWith("exam_1");
    expect(cancelExamAutoClose).toHaveBeenCalledWith(
      expect.objectContaining({
        examId: "exam_1",
        scheduleRevision: 1,
        timerFingerprint: "exam:v1:exam_1:window_a",
      }),
    );
  });

  it("rejects deleting a non-draft exam", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));

    await expect(deleteExamDraft(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
    expect(examDelete).not.toHaveBeenCalled();
  });

  it("rejects when the actor has no permission", async () => {
    examFindById.mockResolvedValue(publishableExam());
    membershipFindByComposite.mockResolvedValue(null);

    await expect(deleteExamDraft(fakeOtherActor, "exam_1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(examDelete).not.toHaveBeenCalled();
  });
});

describe("updateExamRecord — auto-close re-arming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    examLockForUpdate.mockResolvedValue([]);
    examUpdate.mockResolvedValue({});
  });

  it("re-arms auto-close with the new window when a published exam's endsAt changes", async () => {
    const newEndsAt = new Date(Date.now() + 999 * 60_000);
    const published = publishableExam({ status: "published" });
    examFindById.mockResolvedValue(published);
    examUpdate.mockResolvedValue({
      ...published,
      endsAt: newEndsAt,
      scheduleRevision: 2,
      timerFingerprint: "exam:v1:exam_1:window_b",
    });

    await updateExamRecord(fakeActor, "exam_1", { endsAt: newEndsAt.toISOString() });

    expect(replaceExamAutoClose).toHaveBeenCalledTimes(1);
    const [payload] = replaceExamAutoClose.mock.calls[0] as [
      { examId: string; startsAt: string; endsAt: string },
    ];
    expect(payload.examId).toBe("exam_1");
    expect(payload.endsAt).toBe(newEndsAt.toISOString());
  });

  it("does not dispatch when the exam is still a draft", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "draft" }));

    await updateExamRecord(fakeActor, "exam_1", {
      endsAt: new Date(Date.now() + 999 * 60_000).toISOString(),
    });

    expect(replaceExamAutoClose).not.toHaveBeenCalled();
  });

  it("does not dispatch when a published exam changes only non-time fields", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));

    await updateExamRecord(fakeActor, "exam_1", { title: "Renamed" });

    expect(replaceExamAutoClose).not.toHaveBeenCalled();
  });

  it("does not dispatch when a submitted window is identical to the persisted window", async () => {
    const published = publishableExam({ status: "published" });
    examFindById.mockResolvedValue(published);

    await updateExamRecord(fakeActor, "exam_1", {
      startsAt: published.startsAt.toISOString(),
      endsAt: published.endsAt.toISOString(),
    });

    expect(replaceExamAutoClose).not.toHaveBeenCalled();
  });

  it("locks, re-reads, and rejects an end that conflicts with the persisted start", async () => {
    const exam = publishableExam();
    examFindById.mockResolvedValue(exam);

    await expect(
      updateExamRecord(fakeActor, "exam_1", {
        endsAt: new Date(exam.startsAt.getTime() - 1).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(examLockForUpdate).toHaveBeenCalledWith("exam_1");
    expect(examLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      examFindById.mock.invocationCallOrder[0],
    );
    expect(examUpdate).not.toHaveBeenCalled();
  });
});
