import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contestFindById,
  contestLockForUpdate,
  contestProblemCount,
  contestUpdate,
  contestDelete,
  ensureContestLifecycle,
  replaceContestLifecycle,
  cancelContestLifecycle,
} = vi.hoisted(() => ({
  contestFindById: vi.fn(),
  contestLockForUpdate: vi.fn(),
  contestProblemCount: vi.fn(),
  contestUpdate: vi.fn(),
  contestDelete: vi.fn(),
  ensureContestLifecycle: vi.fn(),
  replaceContestLifecycle: vi.fn(),
  cancelContestLifecycle: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: {
    withTx: () => ({
      findById: contestFindById,
      lockForUpdate: contestLockForUpdate,
      update: contestUpdate,
      delete: contestDelete,
    }),
  },
  contestProblemRepo: {
    withTx: () => ({
      countByContestId: contestProblemCount,
      create: vi.fn(),
      deleteByContestId: vi.fn(),
    }),
  },
  participationRepo: { withTx: () => ({}) },
  problemRepo: { withTx: () => ({ findMany: vi.fn() }) },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
}));

import {
  configureDomainOrchestration,
  contestDomain,
  ValidationError,
} from "@nojv/application";

const actor = {
  userId: "usr_teacher",
  username: "teacher",
  displayName: "Teacher",
  email: "teacher@example.com",
  platformRole: "teacher" as const,
};

function contest(overrides: Record<string, unknown> = {}) {
  return {
    id: "contest_1",
    createdByUserId: actor.userId,
    visibility: "draft",
    startsAt: new Date("2030-01-01T00:00:00.000Z"),
    endsAt: new Date("2030-01-10T00:00:00.000Z"),
    frozenAt: null,
    frozenBoard: true,
    scoreboardMode: "live",
    allowedLanguages: ["cpp"],
    scoringMode: "problem_count",
    scheduleRevision: 1,
    timerFingerprint: "contest:v1:contest_1:window_a",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  contestLockForUpdate.mockResolvedValue([]);
  contestUpdate.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
    ...contest(),
    ...data,
    scheduleRevision: 2,
  }));
  contestProblemCount.mockResolvedValue(1);
  configureDomainOrchestration({
    cancelAssignmentDueSoon: vi.fn(() => Promise.resolve()),
    cancelContestLifecycle,
    cancelExamAutoClose: vi.fn(() => Promise.resolve()),
    cancelRejudge: vi.fn(() => Promise.resolve()),
    describeSubmissionJudge: vi.fn(() => Promise.resolve(null)),
    dispatchPlagiarismCheck: vi.fn(() => Promise.resolve()),
    dispatchRegistryGarbageCollect: vi.fn(() =>
      Promise.resolve({
        workflowId: "registry-gc",
        alreadyRunning: false,
      }),
    ),
    dispatchRejudge: vi.fn(() => Promise.resolve({ workflowId: "rejudge-test" })),
    dispatchSubmissionJudge: vi.fn(() => Promise.resolve()),
    ensureAssignmentDueSoon: vi.fn(() => Promise.resolve()),
    ensureContestLifecycle,
    ensureExamAutoClose: vi.fn(() => Promise.resolve()),
    getRejudgeTriggeredBy: vi.fn(() => Promise.resolve(null)),
    probeTemporal: vi.fn(() => Promise.resolve()),
    queryRejudgeProgress: vi.fn(() => Promise.resolve({ completed: 0, total: 0 })),
    replaceAssignmentDueSoon: vi.fn(() => Promise.resolve()),
    replaceContestLifecycle,
    replaceExamAutoClose: vi.fn(() => Promise.resolve()),
    terminateSubmissionJudge: vi.fn(() => Promise.resolve()),
  });
});

describe("contest effective time window", () => {
  it("locks, re-reads, and rejects an end that conflicts with the persisted start", async () => {
    const persisted = contest();
    contestFindById.mockResolvedValue(persisted);

    await expect(
      contestDomain.updateContestRecord(actor, persisted.id, {
        endsAt: new Date(persisted.startsAt.getTime() - 1).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(contestLockForUpdate).toHaveBeenCalledWith(persisted.id);
    expect(contestLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      contestFindById.mock.invocationCallOrder[0],
    );
    expect(contestUpdate).not.toHaveBeenCalled();
  });

  it("locks and re-reads before publishing", async () => {
    const persisted = contest();
    contestFindById.mockResolvedValue(persisted);

    await contestDomain.publishContest(actor, persisted.id);

    expect(contestLockForUpdate).toHaveBeenCalledWith(persisted.id);
    expect(contestLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      contestFindById.mock.invocationCallOrder[0],
    );
    expect(contestUpdate).toHaveBeenCalledWith(persisted.id, { visibility: "published" });
    expect(ensureContestLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: persisted.id,
        scheduleRevision: 2,
        timerFingerprint: "contest:v1:contest_1:window_a",
      }),
    );
  });

  it("replaces lifecycle after a published schedule change", async () => {
    const persisted = contest({ visibility: "published" });
    const endsAt = new Date("2030-01-20T00:00:00.000Z");
    contestFindById.mockResolvedValue(persisted);
    contestUpdate.mockResolvedValue({
      ...persisted,
      endsAt,
      scheduleRevision: 2,
      timerFingerprint: "contest:v1:contest_1:window_b",
    });

    await contestDomain.updateContestRecord(actor, persisted.id, {
      endsAt: endsAt.toISOString(),
    });

    expect(replaceContestLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: persisted.id,
        scheduleRevision: 2,
        timerFingerprint: "contest:v1:contest_1:window_b",
      }),
    );
  });

  it("locks and cancels a deleted draft", async () => {
    const persisted = contest();
    contestFindById.mockResolvedValue(persisted);

    await contestDomain.deleteContestDraft(actor, persisted.id);

    expect(contestLockForUpdate).toHaveBeenCalledWith(persisted.id);
    expect(cancelContestLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: persisted.id,
        scheduleRevision: 1,
        timerFingerprint: "contest:v1:contest_1:window_a",
      }),
    );
  });
});
