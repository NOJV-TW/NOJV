import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryStorage } from "../_fixtures/storage";

const {
  problemFindById,
  userFindById,
  userCreate,
  userUpdate,
  courseFindById,
  courseMembershipFindByComposite,
  assessmentFindByCompositeId,
  workspaceFindByProblemId,
  submissionCountForUserAssessmentProblemSince,
  submissionCreate,
  submissionPublishPendingUpload,
  submissionUpdateStatus,
  submissionCompleteIfInProgress,
  submissionFindMostRecent,
  examSessionFindActiveForUser,
  examFindById,
  examProblemExists,
  txAssessmentProblemFindFirst,
  txContestProblemFindFirst,
  txExecuteRaw,
  durableWorkEnqueue,
  durableWorkEnqueueMany,
  durableWorkCancel,
  proctoringGateInTx,
  storageRef,
  transactionState,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  userFindById: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  courseFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  assessmentFindByCompositeId: vi.fn(),
  workspaceFindByProblemId: vi.fn(),
  submissionCountForUserAssessmentProblemSince: vi.fn(),
  submissionCreate: vi.fn(),
  submissionPublishPendingUpload: vi.fn(),
  submissionUpdateStatus: vi.fn(),
  submissionCompleteIfInProgress: vi.fn(),
  submissionFindMostRecent: vi.fn(),
  examSessionFindActiveForUser: vi.fn(),
  examFindById: vi.fn(),
  examProblemExists: vi.fn(),
  txAssessmentProblemFindFirst: vi.fn(),
  txContestProblemFindFirst: vi.fn(),
  txExecuteRaw: vi.fn(),
  durableWorkEnqueue: vi.fn(),
  durableWorkEnqueueMany: vi.fn(),
  durableWorkCancel: vi.fn(),
  proctoringGateInTx: vi.fn(),
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
  transactionState: { calls: 0, depth: 0 },
}));

vi.mock("@nojv/db", () => {
  return {
    problemRepo: {
      withTx: () => ({ findById: problemFindById }),
    },
    durableWorkRepo: {
      enqueueMany: durableWorkEnqueueMany,
      withTx: () => ({ enqueue: durableWorkEnqueue, cancel: durableWorkCancel }),
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
    assessmentProblemRepo: {
      withTx: () => ({ findLink: txAssessmentProblemFindFirst }),
    },
    contestRepo: {
      withTx: () => ({ findById: vi.fn() }),
    },
    contestProblemRepo: {
      withTx: () => ({ findLink: txContestProblemFindFirst }),
    },
    examSessionRepo: {
      withTx: () => ({ findActiveForUser: examSessionFindActiveForUser }),
    },
    examRepo: {
      withTx: () => ({ findById: examFindById }),
    },
    examProblemRepo: {
      withTx: () => ({ exists: examProblemExists }),
    },
    problemWorkspaceFileRepo: {
      findByProblemId: workspaceFindByProblemId,
    },
    submissionRepo: {
      withTx: () => ({
        countForUserAssessmentProblemSince: submissionCountForUserAssessmentProblemSince,
        create: submissionCreate,
        findMostRecent: submissionFindMostRecent,
        publishPendingUpload: submissionPublishPendingUpload,
      }),
      updateStatus: submissionUpdateStatus,
      completeIfInProgress: submissionCompleteIfInProgress,
    },
    runTransaction: async <T>(
      fn: (tx: { $executeRaw: typeof txExecuteRaw }) => Promise<T>,
    ): Promise<T> => {
      transactionState.calls += 1;
      transactionState.depth += 1;
      try {
        return await fn({ $executeRaw: txExecuteRaw });
      } finally {
        transactionState.depth -= 1;
      }
    },
    Prisma: { DbNull: null },
  };
});

vi.mock("../../../packages/application/src/proctoring/gate", () => ({
  checkProctoringGateInTx: proctoringGateInTx,
}));

vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
  __setStorageClientForTests: (c: unknown) => {
    storageRef.client = c as typeof storageRef.client;
  },
}));

import { ConflictError, ForbiddenError, submissionDomain } from "@nojv/application";
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

function setupSubmitPipelineDefaults(
  maxAttemptsPerDay: number | null,
  attemptResetMinuteOfDay: number | null = null,
) {
  transactionState.calls = 0;
  transactionState.depth = 0;
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
  assessmentFindByCompositeId.mockResolvedValue({
    ...fakeAssessmentBase,
    maxAttemptsPerDay,
    attemptResetMinuteOfDay,
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
  examSessionFindActiveForUser.mockResolvedValue(null);
  txAssessmentProblemFindFirst.mockResolvedValue({ id: "cap_1" });
  txContestProblemFindFirst.mockResolvedValue(null);
  workspaceFindByProblemId.mockResolvedValue([]);
  durableWorkEnqueue.mockResolvedValue({});
  durableWorkEnqueueMany.mockResolvedValue([]);
  durableWorkCancel.mockResolvedValue(true);
  submissionCreate.mockImplementation(async (data: unknown) => ({
    id: `sub_${Math.random().toString(36).slice(2, 8)}`,
    ...(data as object),
  }));
  submissionPublishPendingUpload.mockImplementation(
    async (id: string, sourceStorage: unknown) => ({ id, sourceStorage, status: "queued" }),
  );
  submissionUpdateStatus.mockImplementation(async (id: string, status: string) => ({
    id,
    status,
  }));
  submissionCompleteIfInProgress.mockResolvedValue({ count: 1 });
}

const baseDraft = {
  context: {
    type: "assignment" as const,
    courseId: fakeCourse.id,
    assessmentId: fakeAssessmentBase.id,
  },
  problemId: fakeProblem.id,
  language: "python" as const,
  sourceCode: "print('hi')",
  sampleOnly: false,
};

describe("createQueuedSubmissionRecord — per-day attempt limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to maxAttemptsPerDay submissions within the same attempt window", async () => {
    setupSubmitPipelineDefaults(3);
    vi.setSystemTime(new Date("2026-04-14T08:00:00.000Z"));

    let dbCount = 0;
    submissionCountForUserAssessmentProblemSince.mockImplementation(async () => dbCount);
    submissionCreate.mockImplementation(async () => {
      dbCount += 1;
      return { id: `sub_${String(dbCount)}` };
    });

    for (let i = 0; i < 3; i++) {
      await expect(
        createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
      ).resolves.toBeDefined();
    }

    expect(submissionCountForUserAssessmentProblemSince).toHaveBeenCalledTimes(3);
    expect(submissionCreate).toHaveBeenCalledTimes(3);
  });

  it("rejects the 4th submission on the same UTC day with ConflictError", async () => {
    setupSubmitPipelineDefaults(3);
    vi.setSystemTime(new Date("2026-04-14T15:30:00.000Z"));

    submissionCountForUserAssessmentProblemSince.mockResolvedValue(3);

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("queries with (userId, assessmentId, problemId, Taipei reset-window start)", async () => {
    setupSubmitPipelineDefaults(3); // attemptResetMinuteOfDay null → default 05:00 (300)
    vi.setSystemTime(new Date("2026-04-14T15:30:45.123Z")); // Taipei 23:30 same day
    submissionCountForUserAssessmentProblemSince.mockResolvedValue(0);

    await createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1");

    expect(submissionCountForUserAssessmentProblemSince).toHaveBeenCalledTimes(1);
    const [userId, assessmentId, problemId, sinceTime] =
      submissionCountForUserAssessmentProblemSince.mock.calls[0];
    expect(userId).toBe(fakeActor.userId);
    expect(assessmentId).toBe(fakeAssessmentBase.id);
    expect(problemId).toBe(fakeProblem.id);
    expect(sinceTime).toBeInstanceOf(Date);
    expect((sinceTime as Date).toISOString()).toBe("2026-04-13T21:00:00.000Z");
  });

  it("uses the teacher-configured reset time (Taipei) for the window start", async () => {
    setupSubmitPipelineDefaults(3, 360); // reset at Taipei 06:00 (360 min of day)
    vi.setSystemTime(new Date("2026-04-14T00:00:00.000Z")); // Taipei 08:00, past 06:00
    submissionCountForUserAssessmentProblemSince.mockResolvedValue(0);

    await createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1");

    const [, , , sinceTime] = submissionCountForUserAssessmentProblemSince.mock.calls[0];
    expect((sinceTime as Date).toISOString()).toBe("2026-04-13T22:00:00.000Z");
  });

  it("resets the counter at the Taipei reset time — advancing past it unblocks submissions", async () => {
    setupSubmitPipelineDefaults(3, 0); // reset at Taipei midnight (UTC 16:00)
    vi.setSystemTime(new Date("2026-04-14T15:59:50.000Z"));
    submissionCountForUserAssessmentProblemSince.mockResolvedValueOnce(3);

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(submissionCreate).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-04-14T16:00:05.000Z"));
    submissionCountForUserAssessmentProblemSince.mockResolvedValueOnce(0);

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).resolves.toBeDefined();

    const secondCall = submissionCountForUserAssessmentProblemSince.mock.calls[1];
    expect((secondCall[3] as Date).toISOString()).toBe("2026-04-14T16:00:00.000Z");
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("skips the check when maxAttemptsPerDay is null (unlimited)", async () => {
    setupSubmitPipelineDefaults(null);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1");

    expect(submissionCountForUserAssessmentProblemSince).not.toHaveBeenCalled();
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

    expect(submissionCountForUserAssessmentProblemSince).not.toHaveBeenCalled();
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
  const examDraft = {
    context: { type: "exam" as const, examId: "exam_window" },
    problemId: fakeProblem.id,
    language: "python" as const,
    sourceCode: "print('hi')",
    sampleOnly: false,
  };

  function setupExamSubmitDefaults(endsAt: Date) {
    transactionState.calls = 0;
    transactionState.depth = 0;
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
    examSessionFindActiveForUser.mockResolvedValue({
      id: "es_1",
      examId: "exam_window",
      userId: fakeActor.userId,
      endedAt: null,
    });
    examProblemExists.mockResolvedValue(true);
    proctoringGateInTx.mockResolvedValue({ ok: true });
    examFindById.mockResolvedValue({
      id: "exam_window",
      status: "published",
      allowedLanguages: [],
      startsAt: new Date("2026-04-14T09:00:00.000Z"),
      endsAt,
      submitCooldownSec: 0,
    });
    submissionCreate.mockImplementation(async (data: unknown) => ({
      id: "sub_exam",
      ...(data as object),
    }));
    submissionPublishPendingUpload.mockImplementation(
      async (id: string, sourceStorage: unknown) => ({ id, sourceStorage, status: "queued" }),
    );
    submissionCompleteIfInProgress.mockResolvedValue({ count: 1 });
    durableWorkEnqueue.mockResolvedValue({});
    durableWorkEnqueueMany.mockResolvedValue([]);
    durableWorkCancel.mockResolvedValue(true);
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
    const arg = submissionCreate.mock.calls[0][0] as { context: unknown };
    expect(arg.context).toEqual({ type: "exam", examId: "exam_window" });
  });

  it("enforces the exam submit cooldown when a recent submission exists", async () => {
    setupExamSubmitDefaults(new Date("2026-04-14T10:00:00.000Z"));
    examFindById.mockResolvedValue({
      id: "exam_window",
      status: "published",
      allowedLanguages: [],
      startsAt: new Date("2026-04-14T09:00:00.000Z"),
      endsAt: new Date("2026-04-14T10:00:00.000Z"),
      submitCooldownSec: 30,
    });
    vi.setSystemTime(new Date("2026-04-14T09:30:00.000Z"));
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
      status: "published",
      allowedLanguages: [],
      startsAt: new Date("2026-04-14T09:00:00.000Z"),
      endsAt: new Date("2026-04-14T10:00:00.000Z"),
      submitCooldownSec: 30,
    });
    vi.setSystemTime(new Date("2026-04-14T09:30:00.000Z"));
    submissionFindMostRecent.mockResolvedValue(null);

    await expect(
      createQueuedSubmissionRecord(examDraft, fakeActor, "127.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });
});

describe("createQueuedSubmissionRecord — upload intention lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps slow object storage outside both short database transactions", async () => {
    setupSubmitPipelineDefaults(null);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));
    const backing = createInMemoryStorage();
    storageRef.client = {
      send: vi.fn(async (command: unknown) => {
        expect(transactionState.depth).toBe(0);
        return backing.client.send(command as never);
      }),
    };

    await createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1");

    expect(transactionState.calls).toBe(2);
    expect(submissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: new Date("2026-04-14T10:00:00.000Z"),
        sourceStorage: null,
        status: "pending_upload",
      }),
    );
    expect(submissionPublishPendingUpload).toHaveBeenCalledTimes(1);
  });

  it("uses receipt time when object upload crosses an assignment deadline", async () => {
    setupSubmitPipelineDefaults(null);
    assessmentFindByCompositeId.mockResolvedValue({
      ...fakeAssessmentBase,
      maxAttemptsPerDay: null,
      attemptResetMinuteOfDay: null,
      status: "published",
      opensAt: new Date("2026-04-14T09:00:00.000Z"),
      closesAt: new Date("2026-04-14T10:00:00.000Z"),
    });
    const receivedAt = new Date("2026-04-14T09:59:59.900Z");
    vi.setSystemTime(receivedAt);
    const backing = createInMemoryStorage();
    let crossedDeadline = false;
    storageRef.client = {
      send: vi.fn(async (command: unknown) => {
        const commandName = (command as { constructor: { name: string } }).constructor.name;
        if (!crossedDeadline && commandName === "PutObjectCommand") {
          crossedDeadline = true;
          vi.setSystemTime(new Date("2026-04-14T10:00:00.100Z"));
        }
        return backing.client.send(command as never);
      }),
    };

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).resolves.toEqual(expect.objectContaining({ status: "queued" }));

    expect(submissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: receivedAt, status: "pending_upload" }),
    );
    expect(vi.getMockedSystemTime()).toEqual(new Date("2026-04-14T10:00:00.100Z"));
  });

  it("reserves the daily limit before upload so a concurrent request cannot overbook it", async () => {
    setupSubmitPipelineDefaults(1);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));
    const rows: { id: string; status: string; sourceStorage: unknown }[] = [];
    submissionCountForUserAssessmentProblemSince.mockImplementation(
      async () => rows.filter(({ status }) => status !== "system_error").length,
    );
    submissionCreate.mockImplementation(async (data: Record<string, unknown>) => {
      const row = {
        id: data.id as string,
        status: data.status as string,
        sourceStorage: data.sourceStorage,
      };
      rows.push(row);
      return { ...data, ...row };
    });
    submissionPublishPendingUpload.mockImplementation(
      async (id: string, sourceStorage: unknown) => {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new Error("missing upload intention");
        row.status = "queued";
        row.sourceStorage = sourceStorage;
        return { ...row };
      },
    );

    const backing = createInMemoryStorage();
    let resolveUploadStarted!: () => void;
    let resolveReleaseUpload!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      resolveUploadStarted = resolve;
    });
    const releaseUpload = new Promise<void>((resolve) => {
      resolveReleaseUpload = resolve;
    });
    let heldFirstPut = false;
    storageRef.client = {
      send: vi.fn(async (command: unknown) => {
        const commandName = (command as { constructor: { name: string } }).constructor.name;
        if (!heldFirstPut && commandName === "PutObjectCommand") {
          heldFirstPut = true;
          resolveUploadStarted();
          await releaseUpload;
        }
        return backing.client.send(command as never);
      }),
    };

    const first = createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1");
    await uploadStarted;
    const secondResult = await createQueuedSubmissionRecord(
      baseDraft,
      fakeActor,
      "127.0.0.1",
    ).then(
      () => null,
      (error: unknown) => error,
    );
    resolveReleaseUpload();
    await first;

    expect(secondResult).toBeInstanceOf(ConflictError);
    expect(submissionCreate).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("queued");
  });

  it("leaves a failed upload unpublished and guarded for durable cleanup", async () => {
    setupSubmitPipelineDefaults(null);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));
    const failingStorage = createInMemoryStorage();
    failingStorage.failNext((commandName) => commandName === "PutObjectCommand");
    storageRef.client = failingStorage as unknown as typeof storageRef.client;

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).rejects.toThrow("Simulated storage failure");

    expect(submissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceStorage: null, status: "pending_upload" }),
    );
    expect(submissionCompleteIfInProgress).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: "system_error",
        verdictSummary: expect.objectContaining({
          systemErrorTruncated: expect.stringContaining("Simulated storage failure"),
        }),
      }),
    );
    expect(durableWorkEnqueueMany).toHaveBeenCalledTimes(1);
    expect(durableWorkCancel).not.toHaveBeenCalled();
    expect(submissionPublishPendingUpload).not.toHaveBeenCalled();
    expect(durableWorkEnqueue).not.toHaveBeenCalled();
  });
});
