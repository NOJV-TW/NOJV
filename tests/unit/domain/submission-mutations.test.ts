import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared repo stubs — hoisted so they can be referenced in the vi.mock
// factory below (vi.mock is hoisted above regular imports).
const {
  problemFindById,
  userFindById,
  userCreate,
  userUpdate,
  courseFindById,
  courseMembershipFindByComposite,
  assessmentFindByComposite,
  workspaceFindByProblemId,
  submissionCountForUserAndAssessmentSince,
  submissionCreate
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  userFindById: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  courseFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  assessmentFindByComposite: vi.fn(),
  workspaceFindByProblemId: vi.fn(),
  submissionCountForUserAndAssessmentSince: vi.fn(),
  submissionCreate: vi.fn()
}));

vi.mock("@nojv/db", () => {
  return {
    problemRepo: {
      withTx: () => ({ findById: problemFindById })
    },
    userRepo: {
      withTx: () => ({
        findById: userFindById,
        create: userCreate,
        update: userUpdate
      })
    },
    courseRepo: {
      withTx: () => ({ findById: courseFindById })
    },
    courseMembershipRepo: {
      withTx: () => ({ findByComposite: courseMembershipFindByComposite })
    },
    assessmentRepo: {
      withTx: () => ({ findByComposite: assessmentFindByComposite })
    },
    contestRepo: {
      withTx: () => ({ findBySlug: vi.fn() })
    },
    problemWorkspaceFileRepo: {
      findByProblemId: workspaceFindByProblemId
    },
    submissionRepo: {
      withTx: () => ({
        countForUserAndAssessmentSince: submissionCountForUserAndAssessmentSince,
        create: submissionCreate
      })
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({})
  };
});

import { ConflictError, submissionDomain } from "@nojv/domain";

const { createQueuedSubmissionRecord } = submissionDomain;

const fakeActor = {
  userId: "usr_student",
  username: "student",
  platformRole: "student" as const,
  displayName: "Student One",
  email: "student@example.com"
};

const fakeProblem = {
  id: "prob_warmup",
  type: "full_source",
  authorId: "usr_teacher"
};

const fakeCourse = {
  id: "course_os-lab-spring-2026"
};

const fakeAssessmentBase = {
  id: "ca_hw1",
  courseId: fakeCourse.id,
  slug: "hw1-process-warmup",
  allowedLanguages: [] as string[]
};

function setupSubmitPipelineDefaults(maxAttemptsPerDay: number | null) {
  const user = {
    id: fakeActor.userId,
    name: fakeActor.displayName,
    email: fakeActor.email,
    username: fakeActor.username,
    platformRole: fakeActor.platformRole
  };
  problemFindById.mockResolvedValue(fakeProblem);
  userFindById.mockResolvedValue(user);
  userUpdate.mockResolvedValue(user);
  userCreate.mockResolvedValue(user);
  courseFindById.mockResolvedValue(fakeCourse);
  assessmentFindByComposite.mockResolvedValue({
    ...fakeAssessmentBase,
    maxAttemptsPerDay
  });
  courseMembershipFindByComposite.mockResolvedValue({
    courseId: fakeCourse.id,
    userId: fakeActor.userId,
    status: "active",
    role: "student"
  });
  // full_source problem with zero workspace files → submits a single
  // source file directly (no entry-file check).
  workspaceFindByProblemId.mockResolvedValue([]);
  submissionCreate.mockImplementation(async (data: unknown) => ({
    id: `sub_${Math.random().toString(36).slice(2, 8)}`,
    ...(data as object)
  }));
}

const baseDraft = {
  problemId: fakeProblem.id,
  language: "python" as const,
  sourceCode: "print('hi')",
  sampleOnly: false,
  assessment: {
    courseId: fakeCourse.id,
    assessmentSlug: fakeAssessmentBase.slug
  }
};

describe("createQueuedSubmissionRecord — per-day attempt limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to maxAttemptsPerDay submissions within the same UTC day", async () => {
    setupSubmitPipelineDefaults(3);
    vi.setSystemTime(new Date("2026-04-14T08:00:00.000Z"));

    // Walk the in-memory counter so each call sees the prior count.
    let dbCount = 0;
    submissionCountForUserAndAssessmentSince.mockImplementation(async () => dbCount);
    submissionCreate.mockImplementation(async () => {
      dbCount += 1;
      return { id: `sub_${String(dbCount)}` };
    });

    for (let i = 0; i < 3; i++) {
      await expect(
        createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1")
      ).resolves.toBeDefined();
    }

    expect(submissionCountForUserAndAssessmentSince).toHaveBeenCalledTimes(3);
    expect(submissionCreate).toHaveBeenCalledTimes(3);
  });

  it("rejects the 4th submission on the same UTC day with ConflictError", async () => {
    setupSubmitPipelineDefaults(3);
    vi.setSystemTime(new Date("2026-04-14T15:30:00.000Z"));

    // Already 3 submissions on record for today.
    submissionCountForUserAndAssessmentSince.mockResolvedValue(3);

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1")
    ).rejects.toBeInstanceOf(ConflictError);

    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("passes UTC midnight of the current day as the sinceTime boundary", async () => {
    setupSubmitPipelineDefaults(3);
    vi.setSystemTime(new Date("2026-04-14T15:30:45.123Z"));
    submissionCountForUserAndAssessmentSince.mockResolvedValue(0);

    await createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1");

    expect(submissionCountForUserAndAssessmentSince).toHaveBeenCalledTimes(1);
    const [userId, assessmentId, sinceTime] =
      submissionCountForUserAndAssessmentSince.mock.calls[0];
    expect(userId).toBe(fakeActor.userId);
    expect(assessmentId).toBe(fakeAssessmentBase.id);
    expect(sinceTime).toBeInstanceOf(Date);
    expect((sinceTime as Date).toISOString()).toBe("2026-04-14T00:00:00.000Z");
  });

  it("resets the per-day counter at UTC midnight — advancing the clock to the next day unblocks submissions", async () => {
    setupSubmitPipelineDefaults(3);
    // Start near end of day.
    vi.setSystemTime(new Date("2026-04-14T23:59:50.000Z"));

    // First query: 3 submissions today → reject.
    submissionCountForUserAndAssessmentSince.mockResolvedValueOnce(3);

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1")
    ).rejects.toBeInstanceOf(ConflictError);
    expect(submissionCreate).not.toHaveBeenCalled();

    // Advance to the next UTC day. The count query would now use a
    // fresh start-of-day boundary and return 0.
    vi.setSystemTime(new Date("2026-04-15T00:00:05.000Z"));
    submissionCountForUserAndAssessmentSince.mockResolvedValueOnce(0);

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1")
    ).resolves.toBeDefined();

    // Second call should have used the new day's boundary.
    const secondCall = submissionCountForUserAndAssessmentSince.mock.calls[1];
    expect((secondCall[2] as Date).toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("skips the check when maxAttemptsPerDay is null (unlimited)", async () => {
    setupSubmitPipelineDefaults(null);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1");

    expect(submissionCountForUserAndAssessmentSince).not.toHaveBeenCalled();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("skips the check on sampleOnly runs (doesn't count toward the limit)", async () => {
    setupSubmitPipelineDefaults(3);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await createQueuedSubmissionRecord(
      { ...baseDraft, sampleOnly: true },
      fakeActor,
      "127.0.0.1"
    );

    expect(submissionCountForUserAndAssessmentSince).not.toHaveBeenCalled();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });
});
