// Boundary-condition coverage for createQueuedSubmissionRecord that
// complements `submission-mutations.test.ts` (per-day attempt limit).
//
// Focus: contest cooldown rejection + active-exam lockout.
//
// IP-mismatch / IP-lock rejection lives on the dedicated exam submit
// endpoint, NOT inside `createQueuedSubmissionRecord` — the mutation
// code explicitly does `void clientIp` and only enforces the active-
// exam lockout (assessment/contest payload disallowed while in an
// exam). We therefore pin _that_ behavior here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryStorage } from "../_fixtures/storage";

const {
  problemFindById,
  userFindById,
  userCreate,
  userUpdate,
  contestRepoFindById,
  participationUpsertContestActive,
  workspaceFindByProblemId,
  submissionFindMostRecent,
  submissionCreate,
  submissionUpdateStatus,
  examSessionFindActiveForUser,
  examFindById,
  examProblemExists,
  txContestProblemFindFirst,
  storageRef,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  userFindById: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  contestRepoFindById: vi.fn(),
  participationUpsertContestActive: vi.fn(),
  workspaceFindByProblemId: vi.fn(),
  submissionFindMostRecent: vi.fn(),
  submissionCreate: vi.fn(),
  submissionUpdateStatus: vi.fn(),
  examSessionFindActiveForUser: vi.fn(),
  examFindById: vi.fn(),
  examProblemExists: vi.fn(),
  txContestProblemFindFirst: vi.fn(),
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
}));

vi.mock("@nojv/db", () => ({
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
    withTx: () => ({ upsertContestActive: participationUpsertContestActive }),
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
      countForUserAssessmentProblemSince: vi.fn(),
    }),
    updateStatus: submissionUpdateStatus,
  },
  runTransaction: async <T>(
    fn: (tx: { $executeRaw: typeof vi.fn }) => Promise<T>,
  ): Promise<T> => fn({ $executeRaw: vi.fn().mockResolvedValue(0) }),
}));

vi.mock("../../../packages/domain/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
  __setStorageClientForTests: (c: unknown) => {
    storageRef.client = c as typeof storageRef.client;
  },
}));

import { ConflictError, ForbiddenError, submissionDomain } from "@nojv/domain";

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
  // Active-exam tests run with the clock pinned to 2026-04-14; a far-future
  // endsAt keeps the exam "running" so the new time-window check is a no-op
  // here (window enforcement is covered in submission-mutations.test.ts).
  examFindById.mockResolvedValue({
    id: "exam_default",
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    endsAt: new Date("2026-12-31T23:59:59.000Z"),
  });
  submissionCreate.mockImplementation(async (data: unknown) => ({
    id: `sub_${Math.random().toString(36).slice(2, 8)}`,
    ...(data as object),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

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
    problemId: fakeProblem.id,
    language: "python" as const,
    sourceCode: "print('hi')",
    sampleOnly: false,
    contestId: "ct_1",
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
    // Even if there's a recent submission, sampleOnly bypasses.
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

// ─────────────────────────────────────────────────────────────────────────────

describe("createQueuedSubmissionRecord — active exam lockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupCommonProblemDefaults();
    txContestProblemFindFirst.mockResolvedValue({ id: "cp_1" });
    // Default: the submitted problem IS part of the active exam. The
    // confinement test below flips this to false.
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
    problemId: fakeProblem.id,
    language: "python" as const,
    sourceCode: "print('hi')",
    sampleOnly: false,
  };

  const baseContestDraft = { ...baseFreePracticeDraft, contestId: "ct_1" };

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

    await createQueuedSubmissionRecord(baseFreePracticeDraft, fakeActor, "127.0.0.1");

    expect(submissionCreate).toHaveBeenCalledTimes(1);
    const arg = submissionCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.examId).toBe("exam_42");
    expect(arg.contestId).toBeNull();
    expect(arg.assessmentId).toBeNull();
  });

  it("forbids submitting a problem that is NOT part of the active exam (confinement, P1)", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_42",
      userId: fakeActor.userId,
    });
    // The warm-up problem is public but NOT attached to the active exam:
    // a locked-down exam taker must not be able to use the judge as an
    // oracle for arbitrary problems.
    examProblemExists.mockResolvedValue(false);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(baseFreePracticeDraft, fakeActor, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("admin bypasses the exam problem-membership check (operational recovery)", async () => {
    examSessionFindActiveForUser.mockResolvedValue({
      examId: "exam_42",
      userId: adminActor.userId,
    });
    examProblemExists.mockResolvedValue(false);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await expect(
      createQueuedSubmissionRecord(baseFreePracticeDraft, adminActor, "127.0.0.1"),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("with no active exam session, examId is null on the created submission", async () => {
    examSessionFindActiveForUser.mockResolvedValue(null);
    vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"));

    await createQueuedSubmissionRecord(baseFreePracticeDraft, fakeActor, "127.0.0.1");

    const arg = submissionCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.examId).toBeNull();
  });

  // The IP-mismatch enforcement for exam submissions is owned by the
  // dedicated exam submit endpoint, not by `createQueuedSubmissionRecord`.
  // This test pins that contract: passing an arbitrary client IP must not
  // affect the result of the regular create path. (If you need to enforce
  // IP at this layer, see `domain/exam` instead.)
  it("does NOT reject based on clientIp at this layer (exam IP gating lives elsewhere)", async () => {
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
});

// Sanity import to make sure the type re-export still works.
void ConflictError;
