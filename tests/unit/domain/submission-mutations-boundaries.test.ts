import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryStorage } from "../_fixtures/storage";

const {
  problemFindById,
  userFindById,
  userCreate,
  userUpdate,
  contestRepoFindById,
  participationUpsertContestActive,
  participationFindContest,
  workspaceFindByProblemId,
  submissionFindMostRecent,
  submissionCreate,
  submissionPublishPendingUpload,
  submissionUpdateStatus,
  submissionUpdateStatusIfIn,
  examSessionFindActiveForUser,
  examFindById,
  examProblemExists,
  txContestProblemFindFirst,
  proctoringGateInTx,
  durableWorkEnqueue,
  durableWorkEnqueueMany,
  durableWorkCancel,
  storageRef,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  userFindById: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  contestRepoFindById: vi.fn(),
  participationUpsertContestActive: vi.fn(),
  participationFindContest: vi.fn(),
  workspaceFindByProblemId: vi.fn(),
  submissionFindMostRecent: vi.fn(),
  submissionCreate: vi.fn(),
  submissionPublishPendingUpload: vi.fn(),
  submissionUpdateStatus: vi.fn(),
  submissionUpdateStatusIfIn: vi.fn(),
  examSessionFindActiveForUser: vi.fn(),
  examFindById: vi.fn(),
  examProblemExists: vi.fn(),
  txContestProblemFindFirst: vi.fn(),
  proctoringGateInTx: vi.fn(),
  durableWorkEnqueue: vi.fn(),
  durableWorkEnqueueMany: vi.fn(),
  durableWorkCancel: vi.fn(),
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
}));

vi.mock("@nojv/db", () => ({
  durableWorkRepo: {
    enqueueMany: durableWorkEnqueueMany,
    withTx: () => ({ enqueue: durableWorkEnqueue, cancel: durableWorkCancel }),
  },
  problemRepo: {
    withTx: () => ({ findById: problemFindById }),
  },
  userRepo: {
    withTx: () => ({ findById: userFindById, create: userCreate, update: userUpdate }),
  },
  courseRepo: {
    withTx: () => ({ findById: vi.fn() }),
  },
  courseMembershipRepo: {
    withTx: () => ({ findByComposite: vi.fn() }),
  },
  assessmentRepo: {
    withTx: () => ({ findByCompositeId: vi.fn() }),
  },
  assessmentProblemRepo: {
    withTx: () => ({ findLink: vi.fn() }),
  },
  contestRepo: {
    withTx: () => ({ findById: contestRepoFindById }),
  },
  contestProblemRepo: {
    withTx: () => ({ findLink: txContestProblemFindFirst }),
  },
  participationRepo: {
    withTx: () => ({
      upsertContestActive: participationUpsertContestActive,
      findContestParticipation: participationFindContest,
    }),
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
      findMostRecent: submissionFindMostRecent,
      create: submissionCreate,
      publishPendingUpload: submissionPublishPendingUpload,
      countForUserAssessmentProblemSince: vi.fn(),
    }),
    updateStatus: submissionUpdateStatus,
    updateStatusIfIn: submissionUpdateStatusIfIn,
  },
  runTransaction: async <T>(
    fn: (tx: { $executeRaw: typeof vi.fn }) => Promise<T>,
  ): Promise<T> => fn({ $executeRaw: vi.fn().mockResolvedValue(0) }),
  Prisma: { DbNull: null },
}));

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

const { createQueuedSubmissionRecord } = submissionDomain;

const fakeActor = {
  userId: "usr_student",
  username: "student",
  platformRole: "student" as const,
  displayName: "Student One",
  email: "student@example.com",
};

const adminActor = { ...fakeActor, platformRole: "admin" as const };

const fakeProblem = {
  id: "prob_warmup",
  type: "full_source",
  authorId: "usr_teacher",
  visibility: "public",
};

function setupCommonProblemDefaults() {
  storageRef.client = createInMemoryStorage() as unknown as typeof storageRef.client;
  problemFindById.mockResolvedValue(fakeProblem);
  const user = {
    id: fakeActor.userId,
    name: fakeActor.displayName,
    email: fakeActor.email,
    username: fakeActor.username,
    platformRole: fakeActor.platformRole,
  };
  userFindById.mockResolvedValue(user);
  userUpdate.mockResolvedValue(user);
  userCreate.mockResolvedValue(user);
  workspaceFindByProblemId.mockResolvedValue([]);
  durableWorkEnqueue.mockResolvedValue({});
  durableWorkEnqueueMany.mockResolvedValue([]);
  durableWorkCancel.mockResolvedValue(true);
  examFindById.mockImplementation(async (id: string) => ({
    id,
    status: "published",
    allowedLanguages: [],
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    endsAt: new Date("2026-12-31T23:59:59.000Z"),
  }));
  submissionCreate.mockImplementation(async (data: unknown) => ({
    id: `sub_${Math.random().toString(36).slice(2, 8)}`,
    ...(data as object),
  }));
  submissionUpdateStatus.mockImplementation(async (id: string, status: string) => ({
    id,
    status,
  }));
  submissionUpdateStatusIfIn.mockResolvedValue({ count: 1 });
  submissionPublishPendingUpload.mockImplementation(
    async (id: string, sourceStorage: unknown) => ({ id, sourceStorage, status: "queued" }),
  );
  // Default: the submitter has joined the contest (join gating covered elsewhere).
  participationFindContest.mockResolvedValue({ id: "part_1", status: "active" });
}

describe("createQueuedSubmissionRecord — contest cooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupCommonProblemDefaults();
    examSessionFindActiveForUser.mockResolvedValue(null);
    txContestProblemFindFirst.mockResolvedValue({ id: "cp_1" });
    contestRepoFindById.mockResolvedValue({
      id: "ct_1",
      visibility: "published",
      startsAt: new Date("2026-04-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T23:59:59.000Z"),
      submitCooldownSec: 30,
      allowedLanguages: [],
    });
    participationUpsertContestActive.mockResolvedValue({ id: "cp_1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseDraft = {
    context: { type: "contest" as const, contestId: "ct_1" },
    problemId: fakeProblem.id,
    language: "python" as const,
    sourceCode: "print('hi')",
    sampleOnly: false,
  };

  it("rejects with ForbiddenError when a non-sample submission lands inside the cooldown window", async () => {
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));
    submissionFindMostRecent.mockResolvedValue({
      id: "sub_recent",
      createdAt: new Date("2026-04-14T09:59:50.000Z"), // 10s ago, cooldown=30
    });

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("allows a submission once the cooldown has elapsed", async () => {
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));
    submissionFindMostRecent.mockResolvedValue(null);

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("skips the cooldown check on sampleOnly runs", async () => {
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));
    submissionFindMostRecent.mockResolvedValue({
      id: "sub_recent",
      createdAt: new Date("2026-04-14T09:59:50.000Z"),
    });

    await expect(
      createQueuedSubmissionRecord({ ...baseDraft, sampleOnly: true }, fakeActor, "127.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionFindMostRecent).not.toHaveBeenCalled();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("skips the cooldown check when contest.submitCooldownSec is 0", async () => {
    contestRepoFindById.mockResolvedValue({
      id: "ct_1",
      visibility: "published",
      startsAt: new Date("2026-04-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T23:59:59.000Z"),
      submitCooldownSec: 0,
      allowedLanguages: [],
    });
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionFindMostRecent).not.toHaveBeenCalled();
  });

  it("rejects when the contest restricts languages and the draft uses a disallowed one", async () => {
    contestRepoFindById.mockResolvedValue({
      id: "ct_1",
      visibility: "published",
      startsAt: new Date("2026-04-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T23:59:59.000Z"),
      submitCooldownSec: 0,
      allowedLanguages: ["cpp"],
    });
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(
        { ...baseDraft, language: "python" },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });
});

describe("createQueuedSubmissionRecord — active exam lockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupCommonProblemDefaults();
    proctoringGateInTx.mockResolvedValue({ ok: true });
    txContestProblemFindFirst.mockResolvedValue({ id: "cp_1" });
    examProblemExists.mockResolvedValue(true);
    contestRepoFindById.mockResolvedValue({
      id: "ct_1",
      visibility: "published",
      startsAt: new Date("2026-04-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T23:59:59.000Z"),
      submitCooldownSec: 0,
      allowedLanguages: [],
    });
    participationUpsertContestActive.mockResolvedValue({ id: "cp_1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseFreePracticeDraft = {
    context: { type: "practice" as const },
    problemId: fakeProblem.id,
    language: "python" as const,
    sourceCode: "print('hi')",
    sampleOnly: false,
  };

  const baseContestDraft = {
    ...baseFreePracticeDraft,
    context: { type: "contest" as const, contestId: "ct_1" },
  };
  const baseExamDraft = {
    ...baseFreePracticeDraft,
    context: { type: "exam" as const, examId: "exam_42" },
  };

  it("forbids attaching a contestId while a non-admin has an active exam session", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_1",
      userId: fakeActor.userId,
    });
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(baseContestDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("admin can submit through a contest context even with an active exam (operational recovery)", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_1",
      userId: adminActor.userId,
    });
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));
    submissionFindMostRecent.mockResolvedValue(null);

    await expect(
      createQueuedSubmissionRecord(baseContestDraft, adminActor, "127.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("exam-problem submission writes the active exam's id onto the new submission", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_42",
      userId: fakeActor.userId,
    });
    examProblemExists.mockResolvedValue(true);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await createQueuedSubmissionRecord(baseExamDraft, fakeActor, "127.0.0.1");

    expect(submissionCreate).toHaveBeenCalledTimes(1);
    const arg = submissionCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.context).toEqual({ type: "exam", examId: "exam_42" });
  });

  it("forbids submitting a problem that is NOT part of the active exam (confinement, P1)", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_42",
      userId: fakeActor.userId,
    });
    examProblemExists.mockResolvedValue(false);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(baseExamDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("does not let admin requests bypass exam problem membership", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_42",
      userId: adminActor.userId,
    });
    examProblemExists.mockResolvedValue(false);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(baseExamDraft, adminActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("with no active exam session, examId is null on the created submission", async () => {
    examSessionFindActiveForUser.mockResolvedValue(null);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await createQueuedSubmissionRecord(baseFreePracticeDraft, fakeActor, "127.0.0.1");

    const arg = submissionCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.context).toEqual({ type: "practice" });
  });

  it("does NOT reject based on clientIp when there is no active exam session", async () => {
    examSessionFindActiveForUser.mockResolvedValue(null);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    const okIp = "10.0.0.1";
    const fakeIp = "203.0.113.99";
    await expect(
      createQueuedSubmissionRecord(baseFreePracticeDraft, fakeActor, okIp),
    ).resolves.toBeDefined();
    await expect(
      createQueuedSubmissionRecord(baseFreePracticeDraft, fakeActor, fakeIp),
    ).resolves.toBeDefined();
  });

  it("enforces the exam IP gate on submission — blocks a wrong-IP token submission (P2)", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_42",
      userId: fakeActor.userId,
    });
    examProblemExists.mockResolvedValue(true);
    proctoringGateInTx.mockResolvedValue({ ok: false, reason: "ip_binding" });
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(baseExamDraft, fakeActor, "203.0.113.99"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(proctoringGateInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityKind: "exam", entityId: "exam_42", ip: "203.0.113.99" }),
    );
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("allows a matching-IP submission during an IP-bound exam (gate ok)", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_42",
      userId: fakeActor.userId,
    });
    examProblemExists.mockResolvedValue(true);
    proctoringGateInTx.mockResolvedValue({ ok: true });
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(baseExamDraft, fakeActor, "10.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });
});

void ConflictError;
