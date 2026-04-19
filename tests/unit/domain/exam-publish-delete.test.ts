import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted repo stubs so `vi.mock` can close over them.
const {
  examFindById,
  examUpdate,
  examDelete,
  examProblemCount,
  membershipFindByComposite,
  dispatchExamAutoClose,
  freezeScoreboard,
  unfreezeScoreboard
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  examUpdate: vi.fn(),
  examDelete: vi.fn(),
  examProblemCount: vi.fn(),
  membershipFindByComposite: vi.fn(),
  dispatchExamAutoClose: vi.fn(),
  freezeScoreboard: vi.fn(),
  unfreezeScoreboard: vi.fn()
}));

vi.mock("@nojv/db", () => {
  return {
    examRepo: {
      withTx: () => ({
        findById: examFindById,
        update: examUpdate,
        delete: examDelete
      }),
      update: examUpdate
    },
    examProblemRepo: {
      withTx: () => ({
        countByExamId: examProblemCount,
        create: vi.fn(),
        deleteByExamId: vi.fn()
      }),
      findByExamId: vi.fn(),
      countByExamId: examProblemCount
    },
    examParticipationRepo: {
      withTx: () => ({ upsert: vi.fn(), findByExamAndUser: vi.fn() })
    },
    problemRepo: {
      withTx: () => ({ findMany: vi.fn() })
    },
    submissionRepo: {
      withTx: () => ({ findMostRecent: vi.fn() })
    },
    courseMembershipRepo: {
      withTx: () => ({ findByComposite: membershipFindByComposite })
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({})
  };
});

vi.mock("@nojv/job-dispatch", () => {
  return {
    dispatchExamAutoClose,
    dispatchAssessmentLifecycle: vi.fn(),
    dispatchContestLifecycle: vi.fn(),
    dispatchPlagiarismCheck: vi.fn(),
    dispatchRejudge: vi.fn(),
    dispatchSubmissionJudge: vi.fn(),
    queryPlagiarismStatus: vi.fn(),
    queryRejudgeProgress: vi.fn(),
    querySubmissionStatus: vi.fn(),
    closeClient: vi.fn()
  };
});

vi.mock("@nojv/redis", () => {
  return {
    scoreboard: {
      freezeScoreboard,
      unfreezeScoreboard
    }
  };
});

import { examDomain, ForbiddenError, ValidationError } from "@nojv/domain";

const { publishExam, deleteExamDraft, archiveExam, unarchiveExam, setExamBoardFrozen } =
  examDomain;

const fakeActor = {
  userId: "usr_teacher",
  username: "teacher",
  displayName: "Teacher One",
  email: "teacher@example.com",
  platformRole: "teacher" as const
};

const fakeOtherActor = {
  userId: "usr_outsider",
  username: "outsider",
  displayName: "Outsider",
  email: "outsider@example.com",
  platformRole: "student" as const
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
    ...overrides
  };
}

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
      { examId: string; endsAt: string }
    ];
    expect(payload.examId).toBe("exam_1");
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
        endsAt: new Date(Date.now() - 60 * 60_000)
      })
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
    // Outsider has no active teacher / TA membership.
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
      role: "teacher"
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
      ForbiddenError
    );
    expect(examDelete).not.toHaveBeenCalled();
  });
});

describe("archiveExam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archives a published exam", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));

    await archiveExam(fakeActor, "exam_1");

    expect(examUpdate).toHaveBeenCalledWith("exam_1", { status: "archived" });
  });

  it("rejects archiving a draft", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "draft" }));

    await expect(archiveExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
    expect(examUpdate).not.toHaveBeenCalled();
  });

  it("rejects archiving an already-archived exam", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "archived" }));

    await expect(archiveExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
    expect(examUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the actor has no permission", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));
    membershipFindByComposite.mockResolvedValue(null);

    await expect(archiveExam(fakeOtherActor, "exam_1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(examUpdate).not.toHaveBeenCalled();
  });
});

describe("unarchiveExam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unarchives an archived exam back to published", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "archived" }));

    await unarchiveExam(fakeActor, "exam_1");

    expect(examUpdate).toHaveBeenCalledWith("exam_1", { status: "published" });
  });

  it("rejects unarchiving a published exam", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));

    await expect(unarchiveExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
    expect(examUpdate).not.toHaveBeenCalled();
  });

  it("rejects unarchiving a draft", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "draft" }));

    await expect(unarchiveExam(fakeActor, "exam_1")).rejects.toBeInstanceOf(ValidationError);
    expect(examUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the actor has no permission", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "archived" }));
    membershipFindByComposite.mockResolvedValue(null);

    await expect(unarchiveExam(fakeOtherActor, "exam_1")).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(examUpdate).not.toHaveBeenCalled();
  });
});

describe("setExamBoardFrozen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("freezes the scoreboard and flips frozenBoard=true", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));

    await setExamBoardFrozen(fakeActor, "exam_1", true);

    expect(freezeScoreboard).toHaveBeenCalledWith("exam_1");
    expect(unfreezeScoreboard).not.toHaveBeenCalled();
    expect(examUpdate).toHaveBeenCalledWith("exam_1", { frozenBoard: true });
  });

  it("unfreezes the scoreboard and flips frozenBoard=false", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));

    await setExamBoardFrozen(fakeActor, "exam_1", false);

    expect(unfreezeScoreboard).toHaveBeenCalledWith("exam_1");
    expect(freezeScoreboard).not.toHaveBeenCalled();
    expect(examUpdate).toHaveBeenCalledWith("exam_1", { frozenBoard: false });
  });

  it("rejects when the actor has no permission", async () => {
    examFindById.mockResolvedValue(publishableExam({ status: "published" }));
    membershipFindByComposite.mockResolvedValue(null);

    await expect(setExamBoardFrozen(fakeOtherActor, "exam_1", true)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(freezeScoreboard).not.toHaveBeenCalled();
    expect(examUpdate).not.toHaveBeenCalled();
  });
});
