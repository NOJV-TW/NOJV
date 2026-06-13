import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindById,
  examUpdate,
  examDelete,
  examProblemCount,
  membershipFindByComposite,
  dispatchExamAutoClose,
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  examUpdate: vi.fn(),
  examDelete: vi.fn(),
  examProblemCount: vi.fn(),
  membershipFindByComposite: vi.fn(),
  dispatchExamAutoClose: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  return {
    examRepo: {
      withTx: () => ({
        findById: examFindById,
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
    ...overrides,
  };
}

beforeEach(() => {
  configureDomainOrchestration({
    cancelRejudge: vi.fn(async () => {}),
    dispatchContestLifecycle: vi.fn(async () => {}),
    dispatchExamAutoClose,
    dispatchPlagiarismCheck: vi.fn(async () => {}),
    dispatchRejudge: vi.fn(async () => ({ workflowId: "rejudge-test" })),
    dispatchSubmissionJudge: vi.fn(async () => {}),
    probeTemporal: vi.fn(async () => {}),
    queryRejudgeProgress: vi.fn(async () => ({ completed: 0, total: 0 })),
    terminateSubmissionJudge: vi.fn(async () => {}),
  });
});

describe("publishExam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes a valid draft, updates status, and schedules auto-close", async () => {
    examFindById.mockResolvedValue(publishableExam());
    examProblemCount.mockResolvedValue(1);

    await publishExam(fakeActor, "exam_1");

    expect(examUpdate).toHaveBeenCalledWith("exam_1", { status: "published" });
    expect(dispatchExamAutoClose).toHaveBeenCalledTimes(1);
    const [payload] = dispatchExamAutoClose.mock.calls[0] as [
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
    expect(dispatchExamAutoClose).not.toHaveBeenCalled();
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
    expect(dispatchExamAutoClose).not.toHaveBeenCalled();
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
    examUpdate.mockResolvedValue({});
  });

  it("re-arms auto-close with the new window when a published exam's endsAt changes", async () => {
    const newEndsAt = new Date(Date.now() + 999 * 60_000);
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));

    await updateExamRecord(fakeActor, "exam_1", { endsAt: newEndsAt.toISOString() });

    expect(dispatchExamAutoClose).toHaveBeenCalledTimes(1);
    const [payload] = dispatchExamAutoClose.mock.calls[0] as [
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

    expect(dispatchExamAutoClose).not.toHaveBeenCalled();
  });

  it("does not dispatch when a published exam changes only non-time fields", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));

    await updateExamRecord(fakeActor, "exam_1", { title: "Renamed" });

    expect(dispatchExamAutoClose).not.toHaveBeenCalled();
  });
});
