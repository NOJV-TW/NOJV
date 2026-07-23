import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryStorage } from "../_fixtures/storage";

const {
  problemFindById,
  userFindById,
  userCreate,
  userUpdate,
  workspaceFindByProblemId,
  submissionCreate,
  submissionPublishPendingUpload,
  submissionUpdateStatus,
  submissionCompleteIfInProgress,
  examSessionFindActiveForUser,
  txAssessmentProblemFindFirst,
  txContestProblemFindFirst,
  storageRef,
  durableWorkEnqueue,
  durableWorkEnqueueMany,
  durableWorkCancel,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  userFindById: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  workspaceFindByProblemId: vi.fn(),
  submissionCreate: vi.fn(),
  submissionPublishPendingUpload: vi.fn(),
  submissionUpdateStatus: vi.fn(),
  submissionCompleteIfInProgress: vi.fn(),
  examSessionFindActiveForUser: vi.fn(),
  txAssessmentProblemFindFirst: vi.fn(),
  txContestProblemFindFirst: vi.fn(),
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
  durableWorkEnqueue: vi.fn(),
  durableWorkEnqueueMany: vi.fn(),
  durableWorkCancel: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  return {
    durableWorkRepo: {
      enqueueMany: durableWorkEnqueueMany,
      withTx: () => ({ enqueue: durableWorkEnqueue, cancel: durableWorkCancel }),
    },
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
      withTx: () => ({ findById: vi.fn() }),
    },
    courseMembershipRepo: {
      withTx: () => ({ findByComposite: vi.fn() }),
    },
    assessmentRepo: {
      withTx: () => ({ findByCompositeId: vi.fn() }),
    },
    contestRepo: {
      withTx: () => ({ findById: vi.fn() }),
    },
    examSessionRepo: {
      withTx: () => ({ findActiveForUser: examSessionFindActiveForUser }),
    },
    problemWorkspaceFileRepo: {
      findByProblemId: workspaceFindByProblemId,
    },
    submissionRepo: {
      withTx: () => ({
        countForUserAssessmentProblemSince: vi.fn(),
        create: submissionCreate,
        publishPendingUpload: submissionPublishPendingUpload,
      }),
      updateStatus: submissionUpdateStatus,
      completeIfInProgress: submissionCompleteIfInProgress,
    },
    runTransaction: async <T>(
      fn: (tx: {
        assessmentProblem: { findFirst: typeof txAssessmentProblemFindFirst };
        contestProblem: { findFirst: typeof txContestProblemFindFirst };
      }) => Promise<T>,
    ): Promise<T> =>
      fn({
        assessmentProblem: { findFirst: txAssessmentProblemFindFirst },
        contestProblem: { findFirst: txContestProblemFindFirst },
      }),
    Prisma: { DbNull: null },
  };
});

vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
  __setStorageClientForTests: (c: unknown) => {
    storageRef.client = c as typeof storageRef.client;
  },
}));

import { ConflictError, submissionDomain } from "@nojv/application";

const { createQueuedSubmissionRecord } = submissionDomain;

const fakeActor = {
  userId: "usr_student",
  username: "student",
  platformRole: "student" as const,
  displayName: "Student One",
  email: "student@example.com",
};

function setupPracticeDefaults() {
  storageRef.client = createInMemoryStorage() as unknown as typeof storageRef.client;
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
  examSessionFindActiveForUser.mockResolvedValue(null);
  txAssessmentProblemFindFirst.mockResolvedValue(null);
  txContestProblemFindFirst.mockResolvedValue(null);
  workspaceFindByProblemId.mockResolvedValue([]);
  durableWorkEnqueue.mockResolvedValue({});
  durableWorkEnqueueMany.mockResolvedValue([]);
  durableWorkCancel.mockResolvedValue(true);
  submissionCreate.mockImplementation(async (data: unknown) => ({
    id: `sub_${Math.random().toString(36).slice(2, 8)}`,
    ...(data as object),
  }));
  submissionUpdateStatus.mockImplementation(async (id: string, status: string) => ({
    id,
    status,
  }));
  submissionCompleteIfInProgress.mockResolvedValue({ count: 1 });
  submissionPublishPendingUpload.mockImplementation(
    async (id: string, sourceStorage: unknown) => ({ id, sourceStorage, status: "queued" }),
  );
}

const baseDraft = {
  context: { type: "practice" as const },
  problemId: "prob_special",
  language: "cpp" as const,
  sourceCode: "// advanced-mode upload",
  sampleOnly: false,
};

describe("createQueuedSubmissionRecord — advanced required paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPracticeDefaults();
  });

  it("rejects with ConflictError when a required file path is missing", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_special",
      authorId: "usr_teacher",
      visibility: "public",
      type: "special_env",
      advancedConfig: {
        run: { imageRef: "ghcr.io/acme/ta:1.0", imageSource: "registry" },
        grade: { imageRef: "ghcr.io/acme/ta:1.0", imageSource: "registry" },
        network: { mode: "none" },
      },
      advancedRequiredPaths: ["src/main.c"],
    });

    await expect(
      createQueuedSubmissionRecord(
        {
          ...baseDraft,
          sourceFiles: [{ path: "main.c", content: "int main(){}" }],
        },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(submissionCreate).not.toHaveBeenCalled();
  });

  it("accepts when a folder requirement is satisfied by a nested file", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_special",
      authorId: "usr_teacher",
      visibility: "public",
      type: "special_env",
      advancedConfig: {
        run: { imageRef: "ghcr.io/acme/ta:1.0", imageSource: "registry" },
        grade: { imageRef: "ghcr.io/acme/ta:1.0", imageSource: "registry" },
        network: { mode: "none" },
      },
      advancedRequiredPaths: ["src/"],
    });

    await expect(
      createQueuedSubmissionRecord(
        {
          ...baseDraft,
          sourceFiles: [{ path: "src/util.c", content: "void util(){}" }],
        },
        fakeActor,
        "127.0.0.1",
      ),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });

  it("ignores advancedRequiredPaths on a non-special_env problem (type guard)", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_full",
      authorId: "usr_teacher",
      visibility: "public",
      type: "full_source",
      advancedRequiredPaths: ["src/main.c"],
    });

    await expect(
      createQueuedSubmissionRecord(
        {
          ...baseDraft,
          problemId: "prob_full",
          sourceFiles: [{ path: "main.cpp", content: "int main(){}" }],
        },
        fakeActor,
        "127.0.0.1",
      ),
    ).resolves.toBeDefined();
    expect(submissionCreate).toHaveBeenCalledTimes(1);
  });
});
