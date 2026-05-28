import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryStorage } from "../_fixtures/storage";

// Shared repo stubs — hoisted so they can be referenced in the vi.mock
// factory below (vi.mock is hoisted above regular imports).
const {
  problemFindById,
  userFindById,
  userCreate,
  userUpdate,
  courseFindById,
  courseMembershipFindByComposite,
  assessmentFindByCompositeId,
  workspaceFindByProblemId,
  submissionCountForUserAndAssessmentSince,
  submissionCreate,
  submissionUpdateStatus,
  submissionFindMostRecent,
  examSessionFindActiveForUser,
  examFindById,
  txAssessmentProblemFindFirst,
  txContestProblemFindFirst,
  txExecuteRaw,
  storageRef,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  userFindById: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  courseFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  assessmentFindByCompositeId: vi.fn(),
  workspaceFindByProblemId: vi.fn(),
  submissionCountForUserAndAssessmentSince: vi.fn(),
  submissionCreate: vi.fn(),
  submissionUpdateStatus: vi.fn(),
  submissionFindMostRecent: vi.fn(),
  examSessionFindActiveForUser: vi.fn(),
  examFindById: vi.fn(),
  txAssessmentProblemFindFirst: vi.fn(),
  txContestProblemFindFirst: vi.fn(),
  txExecuteRaw: vi.fn(),
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
}));

vi.mock("@nojv/db", () => {
  return {
    problemRepo: {
      withTx: () => ({ findById: problemFindById }),
    },
    userRepo: {
      withTx: () => ({
        findById: userFindById,
        create: userCreate,
        update: userUpdate,
      }),
    },
    courseRepo: {
      withTx: () => ({ findById: courseFindById }),
    },
    courseMembershipRepo: {
      withTx: () => ({ findByComposite: courseMembershipFindByComposite }),
    },
    assessmentRepo: {
      withTx: () => ({ findByCompositeId: assessmentFindByCompositeId }),
    },
    contestRepo: {
      withTx: () => ({ findById: vi.fn() }),
    },
    examSessionRepo: {
      withTx: () => ({ findActiveForUser: examSessionFindActiveForUser }),
    },
    examRepo: {
      withTx: () => ({ findById: examFindById }),
    },
    problemWorkspaceFileRepo: {
      findByProblemId: workspaceFindByProblemId,
    },
    submissionRepo: {
      withTx: () => ({
        countForUserAndAssessmentSince: submissionCountForUserAndAssessmentSince,
        create: submissionCreate,
        findMostRecent: submissionFindMostRecent,
      }),
      updateStatus: submissionUpdateStatus,
    },
    // createQueuedSubmissionRecord now does direct prisma reads against
    // the assessment/contest problem-link tables for problem-in-context
    // checks; expose those on the mock tx.
    runTransaction: async <T>(
      fn: (tx: {
        courseAssessmentProblem: { findFirst: typeof txAssessmentProblemFindFirst };
        contestProblem: { findFirst: typeof txContestProblemFindFirst };
      }) => Promise<T>,
    ): Promise<T> =>
      fn({
        courseAssessmentProblem: { findFirst: txAssessmentProblemFindFirst },
        contestProblem: { findFirst: txContestProblemFindFirst },
        $executeRaw: txExecuteRaw,
      }),
  };
});

// Storage singleton — return whatever client storageRef.client is set to.
// Tests reassign storageRef.client per case via the in-memory fixture.
vi.mock("../../../packages/domain/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
  __setStorageClientForTests: (c: unknown) => {
    storageRef.client = c as typeof storageRef.client;
  },
}));

import { ConflictError, ForbiddenError, submissionDomain } from "@nojv/domain";
import { supportedLanguages } from "@nojv/core";

const { createQueuedSubmissionRecord } = submissionDomain;

const fakeActor = {
  userId: "usr_student",
  username: "student",
  platformRole: "student" as const,
  displayName: "Student One",
  email: "student@example.com",
};

const fakeProblem = {
  id: "prob_warmup",
  type: "full_source",
  authorId: "usr_teacher",
};

const fakeCourse = {
  id: "course_os-lab-spring-2026",
};

const fakeAssessmentBase = {
  id: "ca_hw1",
  courseId: fakeCourse.id,
  allowedLanguages: [] as string[],
};

function setupSubmitPipelineDefaults(maxAttemptsPerDay: number | null) {
  // Fresh in-memory storage for each test setup; reads via the mocked
  // singleton above (`storage()` returns whatever storageRef.client is).
  storageRef.client = createInMemoryStorage() as unknown as typeof storageRef.client;
  const user = {
    id: fakeActor.userId,
    name: fakeActor.displayName,
    email: fakeActor.email,
    username: fakeActor.username,
    platformRole: fakeActor.platformRole,
  };
  problemFindById.mockResolvedValue({
    ...fakeProblem,
    visibility: "public",
  });
  userFindById.mockResolvedValue(user);
  userUpdate.mockResolvedValue(user);
  userCreate.mockResolvedValue(user);
  courseFindById.mockResolvedValue(fakeCourse);
  // Now that the assessment time-window check runs against opensAt/closesAt,
  // give the test a wide window centered around an arbitrary "now"; tests
  // using vi.setSystemTime stay safely inside it.
  assessmentFindByCompositeId.mockResolvedValue({
    ...fakeAssessmentBase,
    maxAttemptsPerDay,
    status: "published",
    opensAt: new Date("2026-01-01T00:00:00.000Z"),
    closesAt: new Date("2026-12-31T23:59:59.000Z"),
  });
  courseMembershipFindByComposite.mockResolvedValue({
    courseId: fakeCourse.id,
    userId: fakeActor.userId,
    status: "active",
    role: "student",
  });
  // No active exam session → lockout doesn't trigger.
  examSessionFindActiveForUser.mockResolvedValue(null);
  // The assessment link table check needs to confirm the problem is in
  // the assessment; default to "yes".
  txAssessmentProblemFindFirst.mockResolvedValue({ id: "cap_1" });
  txContestProblemFindFirst.mockResolvedValue(null);
  // full_source problem with zero workspace files → submits a single
  // source file directly (no entry-file check).
  workspaceFindByProblemId.mockResolvedValue([]);
  submissionCreate.mockImplementation(async (data: unknown) => ({
    id: `sub_${Math.random().toString(36).slice(2, 8)}`,
    ...(data as object),
  }));
}

const baseDraft = {
  problemId: fakeProblem.id,
  language: "python" as const,
  sourceCode: "print('hi')",
  sampleOnly: false,
  assessment: {
    courseId: fakeCourse.id,
    assessmentId: fakeAssessmentBase.id,
  },
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
        createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
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
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
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
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(submissionCreate).not.toHaveBeenCalled();

    // Advance to the next UTC day. The count query would now use a
    // fresh start-of-day boundary and return 0.
    vi.setSystemTime(new Date("2026-04-15T00:00:05.000Z"));
    submissionCountForUserAndAssessmentSince.mockResolvedValueOnce(0);

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
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
      "127.0.0.1",
    );

    expect(submissionCountForUserAndAssessmentSince).not.toHaveBeenCalled();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });
});

describe("createQueuedSubmissionRecord — language gating by problem type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("full_source accepts every supported language without requiring a workspace entry", async () => {
    setupSubmitPipelineDefaults(null);
    problemFindById.mockResolvedValue({
      ...fakeProblem,
      type: "full_source",
      visibility: "public",
    });
    // Even if pre-migration residue exists, full_source must skip the check.
    workspaceFindByProblemId.mockResolvedValue([]);

    for (const language of supportedLanguages) {
      await expect(
        createQueuedSubmissionRecord(
          { ...baseDraft, language, sourceCode: "x" },
          fakeActor,
          "127.0.0.1",
        ),
      ).resolves.toBeDefined();
    }

    // full_source skips the workspace-entry check entirely.
    expect(workspaceFindByProblemId).not.toHaveBeenCalled();
    expect(submissionCreate).toHaveBeenCalledTimes(supportedLanguages.length);
  });

  it("multi_file rejects a submission when no editable main.<ext> exists for the language", async () => {
    setupSubmitPipelineDefaults(null);
    problemFindById.mockResolvedValue({
      ...fakeProblem,
      type: "multi_file",
      visibility: "public",
    });
    // Editable starter only for python — a java submission should be rejected.
    workspaceFindByProblemId.mockResolvedValue([
      { language: "python", path: "main.py", visibility: "editable", content: "" },
    ]);

    await expect(
      createQueuedSubmissionRecord(
        { ...baseDraft, language: "java", sourceCode: "x" },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("multi_file accepts a submission when an editable main.<ext> exists for the language", async () => {
    setupSubmitPipelineDefaults(null);
    problemFindById.mockResolvedValue({
      ...fakeProblem,
      type: "multi_file",
      visibility: "public",
    });
    workspaceFindByProblemId.mockResolvedValue([
      { language: "python", path: "main.py", visibility: "editable", content: "" },
    ]);

    await expect(
      createQueuedSubmissionRecord(
        { ...baseDraft, language: "python", sourceCode: "x" },
        fakeActor,
        "127.0.0.1",
      ),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("multi_file rejects when the matching path exists but is not editable", async () => {
    setupSubmitPipelineDefaults(null);
    problemFindById.mockResolvedValue({
      ...fakeProblem,
      type: "multi_file",
      visibility: "public",
    });
    workspaceFindByProblemId.mockResolvedValue([
      { language: "python", path: "main.py", visibility: "readonly", content: "" },
    ]);

    await expect(
      createQueuedSubmissionRecord(
        { ...baseDraft, language: "python", sourceCode: "x" },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });
});

describe("createQueuedSubmissionRecord — exam time window", () => {
  // Exam-tagged drafts carry no assessment/contest context — the active
  // session is the source of truth (see the lockout in the mutation).
  const examDraft = {
    problemId: fakeProblem.id,
    language: "python" as const,
    sourceCode: "print('hi')",
    sampleOnly: false,
  };

  function setupExamSubmitDefaults(endsAt: Date) {
    storageRef.client = createInMemoryStorage() as unknown as typeof storageRef.client;
    const user = {
      id: fakeActor.userId,
      name: fakeActor.displayName,
      email: fakeActor.email,
      username: fakeActor.username,
      platformRole: fakeActor.platformRole,
    };
    problemFindById.mockResolvedValue({ ...fakeProblem, visibility: "public" });
    userFindById.mockResolvedValue(user);
    userUpdate.mockResolvedValue(user);
    userCreate.mockResolvedValue(user);
    workspaceFindByProblemId.mockResolvedValue([]);
    // Student is mid-exam: an active (unended) session row exists.
    examSessionFindActiveForUser.mockResolvedValue({
      id: "es_1",
      examId: "exam_window",
      userId: fakeActor.userId,
      endedAt: null,
    });
    examFindById.mockResolvedValue({
      id: "exam_window",
      startsAt: new Date("2026-04-14T09:00:00.000Z"),
      endsAt,
    });
    submissionCreate.mockImplementation(async (data: unknown) => ({
      id: "sub_exam",
      ...(data as object),
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a submission once the exam has ended even while the session row is still active", async () => {
    setupExamSubmitDefaults(new Date("2026-04-14T10:00:00.000Z"));
    // One second past endsAt: the auto-close workflow has not run yet.
    vi.setSystemTime(new Date("2026-04-14T10:00:01.000Z"));

    await expect(
      createQueuedSubmissionRecord(examDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("accepts a submission while the exam is still running and tags it from the session", async () => {
    setupExamSubmitDefaults(new Date("2026-04-14T10:00:00.000Z"));
    vi.setSystemTime(new Date("2026-04-14T09:30:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(examDraft, fakeActor, "127.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
    const arg = submissionCreate.mock.calls[0][0] as { examId: string | null };
    expect(arg.examId).toBe("exam_window");
  });

  it("enforces the exam submit cooldown when a recent submission exists", async () => {
    setupExamSubmitDefaults(new Date("2026-04-14T10:00:00.000Z"));
    examFindById.mockResolvedValue({
      id: "exam_window",
      startsAt: new Date("2026-04-14T09:00:00.000Z"),
      endsAt: new Date("2026-04-14T10:00:00.000Z"),
      submitCooldownSec: 30,
    });
    vi.setSystemTime(new Date("2026-04-14T09:30:00.000Z"));
    // A submission 5s ago is within the 30s cooldown window.
    submissionFindMostRecent.mockResolvedValue({
      createdAt: new Date("2026-04-14T09:29:55.000Z"),
    });

    await expect(
      createQueuedSubmissionRecord(examDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("allows an exam submission once the cooldown window has passed", async () => {
    setupExamSubmitDefaults(new Date("2026-04-14T10:00:00.000Z"));
    examFindById.mockResolvedValue({
      id: "exam_window",
      startsAt: new Date("2026-04-14T09:00:00.000Z"),
      endsAt: new Date("2026-04-14T10:00:00.000Z"),
      submitCooldownSec: 30,
    });
    vi.setSystemTime(new Date("2026-04-14T09:30:00.000Z"));
    // No submission inside the cooldown window.
    submissionFindMostRecent.mockResolvedValue(null);

    await expect(
      createQueuedSubmissionRecord(examDraft, fakeActor, "127.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });
});
