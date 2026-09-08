import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Storage from "@nojv/storage";

const {
  problemCreate,
  problemStatementCreate,
  workspaceDeleteByProblemId,
  workspaceCreateMany,
  problemFindById,
  problemLockForUpdate,
  problemUpdate,
  problemDelete,
  problemFindLinked,
  scoreAuditFind,
  feedbackAuditFind,
  putImmutableText,
  commitStoragePointerSwap,
  guardStorageObjectWrites,
  submissionFindMany,
  submissionFindUnique,
  testcaseSetCountByProblem,
  courseMembershipHasActiveStaff,
  acquireDisplayIdLock,
  maxDisplayId,
  userFindById,
  courseProblemHasStaff,
  courseProblemLockStaff,
  forkProblem,
  userFindByUsername,
  userLock,
  statementUpsert,
  PRISMA_JSON_NULL,
} = vi.hoisted(() => ({
  problemCreate: vi.fn(),
  problemStatementCreate: vi.fn(),
  workspaceDeleteByProblemId: vi.fn(),
  workspaceCreateMany: vi.fn(),
  problemFindById: vi.fn(),
  problemLockForUpdate: vi.fn(),
  problemUpdate: vi.fn(),
  problemDelete: vi.fn(),
  problemFindLinked: vi.fn(),
  scoreAuditFind: vi.fn(),
  feedbackAuditFind: vi.fn(),
  putImmutableText: vi.fn(),
  commitStoragePointerSwap: vi.fn(),
  guardStorageObjectWrites: vi.fn(),
  submissionFindMany: vi.fn(),
  submissionFindUnique: vi.fn(),
  testcaseSetCountByProblem: vi.fn(),
  courseMembershipHasActiveStaff: vi.fn(),
  acquireDisplayIdLock: vi.fn(),
  maxDisplayId: vi.fn(),
  userFindById: vi.fn(),
  courseProblemHasStaff: vi.fn(),
  courseProblemLockStaff: vi.fn(),
  forkProblem: vi.fn(),
  userFindByUsername: vi.fn(),
  userLock: vi.fn(),
  statementUpsert: vi.fn(),
  PRISMA_JSON_NULL: Symbol("Prisma.JsonNull"),
}));

vi.mock("@nojv/storage", async (importOriginal) => {
  const original = await importOriginal<typeof Storage>();
  return {
    ...original,
    createStorageClient: vi.fn(() => ({})),
    putImmutableText,
  };
});

vi.mock("../../../packages/application/src/shared/storage-object-lifecycle", () => ({
  commitStoragePointerSwap,
  guardStorageObjectWrites,
}));

vi.mock("@nojv/db", () => {
  const withTx = {
    create: problemCreate,
    findById: problemFindById,
    lockForUpdate: problemLockForUpdate,
    update: problemUpdate,
    delete: vi.fn(),
    acquireDisplayIdLock,
    maxDisplayId,
  };
  const statementWithTx = {
    create: problemStatementCreate,
    upsert: statementUpsert,
  };
  const workspaceWithTx = {
    deleteByProblemId: workspaceDeleteByProblemId,
    createMany: workspaceCreateMany,
  };
  return {
    Prisma: {
      JsonNull: PRISMA_JSON_NULL,
    },
    problemRepo: {
      withTx: () => withTx,
      findById: problemFindById,
      delete: problemDelete,
    },
    problemStatementRepo: {
      withTx: () => statementWithTx,
    },
    problemWorkspaceFileRepo: {
      withTx: () => ({ ...workspaceWithTx, findByProblemId: vi.fn().mockResolvedValue([]) }),
      findByProblemId: vi.fn().mockResolvedValue([]),
    },
    testcaseSetRepo: { withTx: () => ({ countByProblem: testcaseSetCountByProblem }) },
    testcaseRepo: { withTx: () => ({}) },
    submissionRepo: { findMany: submissionFindMany },
    courseMembershipRepo: { hasActiveStaffMembership: courseMembershipHasActiveStaff },
    courseProblemRepo: {
      hasStaffAccess: courseProblemHasStaff,
      withTx: () => ({
        lockStaffEditAccess: courseProblemLockStaff,
        lockProblem: async (id: string): Promise<unknown> => {
          await problemLockForUpdate(id);
          return problemFindById(id);
        },
      }),
    },
    userRepo: {
      findById: userFindById,
      withTx: () => ({ findById: userFindById, findByUsername: userFindByUsername }),
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({
        $queryRaw: userLock,
        problem: {
          findUnique: problemFindById,
          findFirst: problemFindLinked,
          delete: problemDelete,
        },
        submission: { findUnique: submissionFindUnique, findMany: submissionFindMany },
        scoreOverrideAuditLog: { findFirst: scoreAuditFind },
        submissionFeedbackAuditLog: { findFirst: feedbackAuditFind },
      }),
  };
});

vi.mock("../../../packages/application/src/problem/fork", () => ({
  forkProblemInTransaction: forkProblem,
}));

import { ConflictError, ForbiddenError, problemDomain } from "@nojv/application";

const {
  createProblemDefinition,
  updateProblemWorkspace,
  updateProblemRecord,
  updateAdvancedJudgeConfiguration,
  deleteProblemRecord,
  hasVerifiedAdvancedJudgeRun,
} = problemDomain;

const fakeTx = {} as never;

const baseInput = {
  authorId: "usr_1",
  difficulty: "easy" as const,
  title: "Test Problem",
};

describe("createProblemDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    problemCreate.mockResolvedValue({ id: "prob_1" });
  });

  it("defaults type to full_source and leaves advancedConfig unset", async () => {
    await createProblemDefinition(fakeTx, baseInput);

    expect(problemCreate).toHaveBeenCalledTimes(1);
    const data = problemCreate.mock.calls[0][0];
    expect(data.type).toBe("full_source");
    expect(data.samples).toBe(PRISMA_JSON_NULL);
    expect(data.advancedConfig).toBeUndefined();
  });

  it("honors type: 'special_env' explicitly passed by the caller", async () => {
    await createProblemDefinition(fakeTx, { ...baseInput, type: "special_env" });

    const data = problemCreate.mock.calls[0][0];
    expect(data.type).toBe("special_env");
  });

  it("leaves advancedConfig unset when type is special_env and config omitted", async () => {
    await createProblemDefinition(fakeTx, { ...baseInput, type: "special_env" });

    const data = problemCreate.mock.calls[0][0];
    expect(data.advancedConfig).toBeUndefined();
  });

  it("preserves caller-supplied advancedConfig when provided", async () => {
    const config = {
      run: { imageRef: "ghcr.io/acme/ta:1.2.3", imageSource: "registry" as const },
      grade: { imageRef: "ghcr.io/acme/ta:1.2.3", imageSource: "registry" as const },
      network: { mode: "none" as const },
      maxScore: 100,
    };
    await createProblemDefinition(fakeTx, {
      ...baseInput,
      type: "special_env",
      advancedConfig: config,
    });

    const data = problemCreate.mock.calls[0][0];
    expect(data.advancedConfig).toEqual(config);
  });

  it("writes difficulty to its dedicated column and leaves tags untouched", async () => {
    await createProblemDefinition(fakeTx, {
      ...baseInput,
      difficulty: "hard",
      tags: ["graph", "dp"],
    });

    const data = problemCreate.mock.calls[0][0];
    expect(data.difficulty).toBe("hard");
    expect(data.tags).toEqual(["graph", "dp"]);
  });
});

describe("updateProblemWorkspace — 1 MB per-language quota", () => {
  const actor = {
    userId: "usr_author",
    username: "author",
    platformRole: "teacher" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    problemFindById.mockResolvedValue({
      id: "prob_1",
      authorId: "usr_author",
      judgeConfig: null,
    });
    workspaceDeleteByProblemId.mockResolvedValue(undefined);
    workspaceCreateMany.mockResolvedValue(undefined);
    problemUpdate.mockResolvedValue(undefined);
    putImmutableText.mockImplementation((_client: unknown, key: string, content: string) => ({
      key,
      sha256: "a".repeat(64),
      size: Buffer.byteLength(content),
    }));
    guardStorageObjectWrites.mockResolvedValue(undefined);
    commitStoragePointerSwap.mockResolvedValue(undefined);
  });

  it("accepts under-budget content (well below 1 MB)", async () => {
    await expect(
      updateProblemWorkspace(actor, "prob_1", {
        files: [
          {
            language: "python",
            path: "main.py",
            content: "print('hello')\n",
            visibility: "editable",
          },
        ],
      }),
    ).resolves.toEqual({ id: "prob_1", fileCount: 1 });
    expect(workspaceCreateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects when a single language exceeds 1 MB across multiple files", async () => {
    const chunk = "a".repeat(600_000);
    await expect(
      updateProblemWorkspace(actor, "prob_1", {
        files: [
          {
            language: "python",
            path: "main.py",
            content: "print('hi')\n",
            visibility: "editable",
          },
          {
            language: "python",
            path: "big_a.py",
            content: chunk,
            visibility: "editable",
          },
          {
            language: "python",
            path: "big_b.py",
            content: chunk,
            visibility: "editable",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(workspaceDeleteByProblemId).not.toHaveBeenCalled();
  });

  it("allows a mix where one language fits and another is under-budget", async () => {
    const pythonChunk = "p".repeat(900_000); // under 1 MB
    const cppChunk = "c".repeat(500_000);
    await expect(
      updateProblemWorkspace(actor, "prob_1", {
        files: [
          {
            language: "python",
            path: "main.py",
            content: pythonChunk,
            visibility: "editable",
          },
          {
            language: "cpp",
            path: "main.cpp",
            content: cppChunk,
            visibility: "editable",
          },
        ],
      }),
    ).resolves.toEqual({ id: "prob_1", fileCount: 2 });
  });

  it("rejects only the offending language when another language fits", async () => {
    const pythonChunk = "p".repeat(10);
    const cppBig = "c".repeat(1_100_000);
    await expect(
      updateProblemWorkspace(actor, "prob_1", {
        files: [
          {
            language: "python",
            path: "main.py",
            content: pythonChunk,
            visibility: "editable",
          },
          {
            language: "cpp",
            path: "main.cpp",
            content: cppBig,
            visibility: "editable",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("over-budget error carries the per-language byte count in its message", async () => {
    const chunk = "a".repeat(1_100_000);
    await expect(
      updateProblemWorkspace(actor, "prob_1", {
        files: [
          {
            language: "python",
            path: "main.py",
            content: chunk,
            visibility: "editable",
          },
        ],
      }),
    ).rejects.toThrow(/python.*1 MB limit.*1100000 bytes/);
  });
});

describe("updateAdvancedJudgeConfiguration", () => {
  const actor = { userId: "usr_admin", username: "admin", platformRole: "admin" as const };
  const digest = `sha256:${"a".repeat(64)}`;
  const config = {
    run: { imageRef: `ghcr.io/nojv-tw/run@${digest}`, imageSource: "registry" as const },
    grade: { imageRef: `ghcr.io/nojv-tw/grade@${digest}`, imageSource: "registry" as const },
    network: { mode: "none" as const },
    maxScore: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    problemLockForUpdate.mockResolvedValue(undefined);
    problemUpdate.mockResolvedValue(undefined);
  });

  it("rejects a non-Advanced problem", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_full",
      authorId: "usr_author",
      type: "full_source",
      status: "draft",
    });

    await expect(
      updateAdvancedJudgeConfiguration(actor, "prob_full", {
        config,
        requiredPaths: ["src/main.c"],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(problemUpdate).not.toHaveBeenCalled();
  });

  it("atomically persists config and required paths after locking the problem", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_se",
      authorId: "usr_author",
      type: "special_env",
      status: "draft",
    });

    await expect(
      updateAdvancedJudgeConfiguration(actor, "prob_se", {
        config,
        requiredPaths: ["src/main.c", "src/"],
      }),
    ).resolves.toBeUndefined();
    expect(problemLockForUpdate).toHaveBeenCalledWith("prob_se");
    expect(problemUpdate).toHaveBeenCalledWith("prob_se", {
      advancedConfig: config,
      advancedRequiredPaths: ["src/main.c", "src/"],
    });
  });

  it("rejects changes to a published Advanced problem", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_se",
      authorId: "usr_author",
      type: "special_env",
      status: "published",
    });

    await expect(
      updateAdvancedJudgeConfiguration(actor, "prob_se", {
        config,
        requiredPaths: ["src/main.c"],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(problemUpdate).not.toHaveBeenCalled();
  });
});

describe("updateProblemRecord — published Advanced configuration immutability", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const config = {
    run: { imageRef: `ghcr.io/nojv-tw/run@${digest}`, imageSource: "registry" as const },
    grade: { imageRef: `ghcr.io/nojv-tw/grade@${digest}`, imageSource: "registry" as const },
    network: { mode: "none" as const },
    maxScore: 100,
  };
  const admin = {
    userId: "usr_admin",
    username: "admin",
    platformRole: "admin" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    problemFindById.mockResolvedValue({
      id: "prob_se",
      authorId: "usr_author",
      type: "special_env",
      status: "published",
      title: "Published Advanced",
      displayId: 1,
      advancedConfig: config,
    });
  });

  it("rejects image/config changes before writing", async () => {
    await expect(
      updateProblemRecord(admin, "prob_se", {
        advancedConfig: { ...config, maxScore: 200 },
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(problemUpdate).not.toHaveBeenCalled();
  });

  it.each([{ timeLimitMs: 2_000 }, { memoryLimitMb: 512 }])(
    "rejects resource-limit changes before writing: %o",
    async (payload) => {
      await expect(updateProblemRecord(admin, "prob_se", payload)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(problemUpdate).not.toHaveBeenCalled();
    },
  );
});

describe("updateProblemRecord — publication permissions", () => {
  const student = {
    userId: "usr_student",
    username: "student",
    platformRole: "student" as const,
  };
  const draft = {
    id: "prob_private",
    authorId: student.userId,
    type: "full_source",
    status: "draft",
    visibility: "private",
    title: "Private problem",
    displayId: null,
    advancedConfig: null,
    advancedRequiredPaths: [],
    timeLimitMs: 1_000,
    memoryLimitMb: 256,
    storageGeneration: 3,
    referenceSolutionSubmissionId: "sub_reference",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    problemFindById.mockResolvedValue(draft);
    testcaseSetCountByProblem.mockResolvedValue(1);
    submissionFindUnique.mockResolvedValue({
      assessmentId: null,
      contestId: null,
      courseId: null,
      examId: null,
      isReferenceSolution: true,
      participationId: null,
      problemId: draft.id,
      referenceProblemStorageGeneration: draft.storageGeneration,
      sampleOnly: false,
      sourceStorage: { key: "reference.c" },
      status: "accepted",
    });
    acquireDisplayIdLock.mockResolvedValue(undefined);
    maxDisplayId.mockResolvedValue({ _max: { displayId: 41 } });
    problemUpdate.mockResolvedValue(undefined);
    courseMembershipHasActiveStaff.mockResolvedValue(false);
  });

  it("allows a student author to publish a private problem", async () => {
    await expect(
      updateProblemRecord(student, draft.id, { status: "published" }),
    ).resolves.toEqual({ id: draft.id });

    expect(problemUpdate).toHaveBeenCalledWith(draft.id, {
      displayId: 42,
      status: "published",
    });
  });

  it("rejects public publication by an ordinary student", async () => {
    problemFindById.mockResolvedValue({ ...draft, visibility: "public" });

    await expect(
      updateProblemRecord(student, draft.id, { status: "published" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(problemUpdate).not.toHaveBeenCalled();
  });

  it("allows an active course TA to publish a public problem", async () => {
    problemFindById.mockResolvedValue({ ...draft, visibility: "public" });
    courseMembershipHasActiveStaff.mockResolvedValue(true);

    await expect(
      updateProblemRecord(student, draft.id, { status: "published" }),
    ).resolves.toEqual({ id: draft.id });
    expect(problemUpdate).toHaveBeenCalledWith(draft.id, {
      displayId: 42,
      status: "published",
    });
  });
});

describe("deleteProblemRecord — context-link guard (P1)", () => {
  const actor = {
    userId: "usr_author",
    username: "author",
    platformRole: "teacher" as const,
    displayName: "Author",
    email: "author@example.com",
  };
  const ownedProblem = {
    id: "prob_1",
    authorId: "usr_author",
    visibility: "private",
    status: "draft",
    checkerStorage: null,
    interactorStorage: null,
    workspaceFiles: [],
    testcaseSets: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    problemFindById.mockResolvedValue(ownedProblem);
    problemDelete.mockResolvedValue(ownedProblem);
    submissionFindMany.mockResolvedValue([]);
    scoreAuditFind.mockResolvedValue(null);
    feedbackAuditFind.mockResolvedValue(null);
  });

  it("refuses to delete a problem still linked to a contest/exam/assignment", async () => {
    problemFindLinked.mockResolvedValue({ id: "prob_1" });

    await expect(deleteProblemRecord(actor, "prob_1")).rejects.toBeInstanceOf(ConflictError);
    expect(problemDelete).not.toHaveBeenCalled();
  });

  it("deletes a problem with no context links", async () => {
    problemFindLinked.mockResolvedValue(null);

    await expect(deleteProblemRecord(actor, "prob_1")).resolves.toBeDefined();
    expect(problemDelete).toHaveBeenCalledWith({ where: { id: "prob_1" } });
  });

  it.each([
    ["score override", scoreAuditFind],
    ["submission feedback", feedbackAuditFind],
  ] as const)(
    "retains a draft referenced only by %s audit history, even for admins",
    async (_name, findAudit) => {
      problemFindLinked.mockResolvedValue(null);
      findAudit.mockResolvedValue({ id: "historical_audit" });

      for (const platformRole of ["teacher", "admin"] as const) {
        await expect(
          deleteProblemRecord({ ...actor, platformRole }, ownedProblem.id),
        ).rejects.toThrow(/historical grading/);
      }
      expect(findAudit).toHaveBeenCalledWith({
        where: { problemId: ownedProblem.id },
        select: { id: true },
      });
      expect(problemLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        findAudit.mock.invocationCallOrder[0],
      );
      expect(problemDelete).not.toHaveBeenCalled();
      expect(commitStoragePointerSwap).not.toHaveBeenCalled();
    },
  );

  it("refuses to delete a published problem, guarding its submission history", async () => {
    problemFindById.mockResolvedValue({ ...ownedProblem, status: "published" });
    problemFindLinked.mockResolvedValue(null);

    await expect(deleteProblemRecord(actor, "prob_1")).rejects.toBeInstanceOf(ConflictError);
    expect(problemDelete).not.toHaveBeenCalled();
  });
});

describe("hasVerifiedAdvancedJudgeRun — publish gate signal", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const config = {
    run: { imageRef: `ghcr.io/nojv-tw/run@${digest}`, imageSource: "registry" },
    grade: { imageRef: `ghcr.io/nojv-tw/grade@${digest}`, imageSource: "registry" },
    network: { mode: "none" },
    maxScore: 100,
  };
  const resourceLimits = { totalTimeMs: 1_000, memoryMb: 256 };
  const snapshot = { config, requiredPaths: ["main.py"], resourceLimits };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when the stored config does not parse", async () => {
    await expect(hasVerifiedAdvancedJudgeRun("prob_1", null, [], resourceLimits)).resolves.toBe(
      false,
    );
    expect(submissionFindMany).not.toHaveBeenCalled();
  });

  it("returns false when no accepted submission snapshot matches", async () => {
    submissionFindMany.mockResolvedValue([
      {
        advancedConfigSnapshot: {
          ...snapshot,
          config: {
            ...config,
            run: { ...config.run, imageRef: "ghcr.io/x/old@" + digest },
          },
        },
      },
      { advancedConfigSnapshot: null },
    ]);
    await expect(
      hasVerifiedAdvancedJudgeRun("prob_1", config, ["main.py"], resourceLimits),
    ).resolves.toBe(false);
  });

  it("returns true when an accepted snapshot matches the current config and paths", async () => {
    submissionFindMany.mockResolvedValue([{ advancedConfigSnapshot: snapshot }]);
    await expect(
      hasVerifiedAdvancedJudgeRun("prob_1", config, ["main.py"], resourceLimits),
    ).resolves.toBe(true);
    expect(submissionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { problemId: "prob_1", status: "accepted" } }),
    );
  });

  it("returns false when maxScore changed after the accepted run", async () => {
    submissionFindMany.mockResolvedValue([
      { advancedConfigSnapshot: { ...snapshot, config: { ...config, maxScore: 50 } } },
    ]);

    await expect(
      hasVerifiedAdvancedJudgeRun("prob_1", config, ["main.py"], resourceLimits),
    ).resolves.toBe(false);
  });

  it("returns false when required paths changed after the accepted run", async () => {
    submissionFindMany.mockResolvedValue([{ advancedConfigSnapshot: snapshot }]);

    await expect(
      hasVerifiedAdvancedJudgeRun("prob_1", config, ["solver.py"], resourceLimits),
    ).resolves.toBe(false);
  });

  it("returns false when resource limits changed after the accepted run", async () => {
    submissionFindMany.mockResolvedValue([{ advancedConfigSnapshot: snapshot }]);

    await expect(
      hasVerifiedAdvancedJudgeRun("prob_1", config, ["main.py"], {
        totalTimeMs: 2_000,
        memoryMb: 256,
      }),
    ).resolves.toBe(false);
  });

  it("returns false when network mode changed after the accepted run", async () => {
    submissionFindMany.mockResolvedValue([
      {
        advancedConfigSnapshot: {
          ...snapshot,
          config: {
            ...config,
            network: {
              mode: "service",
              service: { imageRef: `ghcr.io/nojv-tw/svc@${digest}`, imageSource: "registry" },
            },
          },
        },
      },
    ]);

    await expect(
      hasVerifiedAdvancedJudgeRun("prob_1", config, ["main.py"], resourceLimits),
    ).resolves.toBe(false);
  });

  it("requires the service image to match in service mode", async () => {
    const serviceConfig = {
      ...config,
      network: {
        mode: "service",
        service: { imageRef: `ghcr.io/nojv-tw/svc@${digest}`, imageSource: "registry" },
      },
    };
    submissionFindMany.mockResolvedValue([
      {
        advancedConfigSnapshot: {
          config: {
            ...serviceConfig,
            network: {
              mode: "service",
              service: { imageRef: `ghcr.io/nojv-tw/other@${digest}`, imageSource: "registry" },
            },
          },
          requiredPaths: ["main.py"],
          resourceLimits,
        },
      },
    ]);
    await expect(
      hasVerifiedAdvancedJudgeRun("prob_1", serviceConfig, ["main.py"], resourceLimits),
    ).resolves.toBe(false);
  });
});

describe("course content publication and ownership", () => {
  const owner = { userId: "owner", username: "owner", platformRole: "teacher" as const };
  const ta = { userId: "ta", username: "ta", platformRole: "student" as const };
  const admin = { userId: "admin", username: "admin", platformRole: "admin" as const };
  const problem = {
    id: "private",
    authorId: owner.userId,
    visibility: "private",
    status: "draft",
    adminMayPublish: false,
    title: "Shared",
    type: "full_source",
    displayId: null,
    advancedConfig: null,
    advancedRequiredPaths: [],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    judgeConfig: { type: "standard" },
    storageGeneration: 2,
    referenceSolutionSubmissionId: "ref",
  };
  beforeEach(() => {
    vi.clearAllMocks();
    problemFindById.mockResolvedValue(problem);
    courseProblemHasStaff.mockResolvedValue(true);
    courseProblemLockStaff.mockResolvedValue(true);
    courseMembershipHasActiveStaff.mockResolvedValue(true);
    testcaseSetCountByProblem.mockResolvedValue(1);
    submissionFindUnique.mockResolvedValue({
      problemId: problem.id,
      isReferenceSolution: true,
      sampleOnly: false,
      status: "accepted",
      sourceStorage: {},
      assessmentId: null,
      contestId: null,
      courseId: null,
      examId: null,
      participationId: null,
      referenceProblemStorageGeneration: problem.storageGeneration,
    });
    forkProblem.mockResolvedValue({
      ...problem,
      id: "public-fork",
      displayId: 42,
      status: "published",
      visibility: "public",
    });
    maxDisplayId.mockResolvedValue({ _max: { displayId: 41 } });
    userFindByUsername.mockResolvedValue({ id: "target" });
    userFindById.mockResolvedValue({
      id: "target",
      username: "new_owner",
      disabled: false,
      canCreateAdvancedProblems: true,
    });
  });

  it("allows a TA to publish private content with unchanged management and judge fields", async () => {
    await expect(
      updateProblemRecord(ta, problem.id, {
        title: "Edited",
        visibility: "private",
        adminMayPublish: false,
        status: "published",
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        type: "full_source",
        judgeConfig: { type: "standard" },
      }),
    ).resolves.toEqual({ id: problem.id });
    const data: unknown = problemUpdate.mock.calls[0][1];
    expect(data).toMatchObject({ title: "Edited", status: "published" });
    expect(data).not.toHaveProperty("adminMayPublish");
    expect(data).not.toHaveProperty("storageGeneration");
    expect(forkProblem).not.toHaveBeenCalled();
  });

  it.each([{ visibility: "public" as const }, { adminMayPublish: true }])(
    "rejects coeditor management changes %o",
    async (payload) => {
      await expect(updateProblemRecord(ta, problem.id, payload)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(problemUpdate).not.toHaveBeenCalled();
      expect(forkProblem).not.toHaveBeenCalled();
    },
  );

  it.each([owner, { ...admin, userId: owner.userId }])(
    "forks owner publication without mutating private content ($platformRole)",
    async (actor) => {
      await expect(
        updateProblemRecord(actor, problem.id, {
          visibility: "public",
          statement: "Published text",
        }),
      ).resolves.toEqual({ id: "public-fork" });
      expect(forkProblem).toHaveBeenCalledWith(expect.anything(), problem.id, {
        authorId: actor.userId,
        published: true,
        requirePublishedPublicSource: false,
      });
      expect(problemUpdate.mock.calls.every(([id]) => id === "public-fork")).toBe(true);
      expect(statementUpsert).toHaveBeenCalledWith(
        "public-fork",
        expect.objectContaining({ problemId: "public-fork" }),
        expect.anything(),
      );
    },
  );

  it("forks the admin's own already-published private problem", async () => {
    problemFindById.mockResolvedValue({
      ...problem,
      authorId: admin.userId,
      status: "published",
    });
    await expect(problemDomain.publishProblemAsAdmin(admin, problem.id)).resolves.toEqual({
      id: "public-fork",
    });
    expect(problemUpdate).not.toHaveBeenCalled();
  });

  it("requires and consumes owner consent for admin publication", async () => {
    await expect(problemDomain.publishProblemAsAdmin(admin, problem.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(forkProblem).not.toHaveBeenCalled();
    problemFindById.mockResolvedValue({ ...problem, adminMayPublish: true });
    await expect(problemDomain.publishProblemAsAdmin(admin, problem.id)).resolves.toEqual({
      id: "public-fork",
    });
    expect(problemUpdate).toHaveBeenCalledExactlyOnceWith(problem.id, {
      adminMayPublish: false,
    });
  });

  it("does not consume consent if the public fork fails", async () => {
    problemFindById.mockResolvedValue({ ...problem, adminMayPublish: true });
    forkProblem.mockRejectedValueOnce(new Error("fork failed"));
    await expect(problemDomain.publishProblemAsAdmin(admin, problem.id)).rejects.toThrow(
      "fork failed",
    );
    expect(problemUpdate).not.toHaveBeenCalled();
  });

  it.each([owner, admin])(
    "preserves existing public maintenance for $platformRole",
    async (actor) => {
      problemFindById.mockResolvedValue({
        ...problem,
        visibility: "public",
        status: "published",
      });
      await expect(
        updateProblemRecord(actor, problem.id, {
          title: "Maintained",
          status: "published",
          adminMayPublish: false,
        }),
      ).resolves.toEqual({ id: problem.id });
      expect(forkProblem).not.toHaveBeenCalled();
    },
  );

  it("transfers to a locked available username and clears the former owner's consent", async () => {
    await expect(
      problemDomain.transferProblemOwnership(owner, problem.id, "NEW_OWNER"),
    ).resolves.toEqual({ id: problem.id, authorId: "target" });
    expect(userFindByUsername).toHaveBeenCalledWith("new_owner");
    expect(problemLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      userLock.mock.invocationCallOrder[0],
    );
    expect(problemUpdate).toHaveBeenCalledWith(problem.id, {
      authorId: "target",
      adminMayPublish: false,
    });
  });

  it("does not give a coeditor ownership management", async () => {
    await expect(
      problemDomain.transferProblemOwnership(ta, problem.id, "new_owner"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(problemUpdate).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { id: "target", disabled: true, username: "new_owner" },
    { id: "target", disabled: false, username: "renamed" },
  ])("rejects an unavailable target after its user lock: %o", async (target) => {
    userFindById.mockResolvedValue(target);
    await expect(
      problemDomain.transferProblemOwnership(owner, problem.id, "new_owner"),
    ).rejects.toThrow();
    expect(problemUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unregistered username", async () => {
    userFindByUsername.mockResolvedValue(null);
    await expect(
      problemDomain.transferProblemOwnership(owner, problem.id, "new_owner"),
    ).rejects.toThrow(/existing user/);
    expect(problemUpdate).not.toHaveBeenCalled();
  });

  it.each([owner, ta])(
    "checks Advanced authorization before the generic config guard for $username",
    async (actor) => {
      const config = {
        run: {
          imageRef: `ghcr.io/nojv/run@sha256:${"a".repeat(64)}`,
          imageSource: "registry" as const,
        },
        grade: {
          imageRef: `ghcr.io/nojv/grade@sha256:${"b".repeat(64)}`,
          imageSource: "registry" as const,
        },
        network: { mode: "none" as const },
        maxScore: 100,
      };
      const payload = { type: "special_env" as const, advancedConfig: config };
      userFindById.mockResolvedValue({ canCreateAdvancedProblems: false });
      await expect(updateProblemRecord(actor, problem.id, payload)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(userFindById).toHaveBeenCalledWith(actor.userId);
      expect(problemUpdate).not.toHaveBeenCalled();

      userFindById.mockResolvedValue({ canCreateAdvancedProblems: true });
      await expect(updateProblemRecord(actor, problem.id, payload)).rejects.toThrow(
        "Use the Advanced judge configuration action to change images.",
      );
      expect(problemUpdate).not.toHaveBeenCalled();
    },
  );

  it("checks retained image refs against the locked configuration", async () => {
    const config = {
      run: {
        imageRef: `ghcr.io/nojv/run@sha256:${"a".repeat(64)}`,
        imageSource: "registry" as const,
      },
      grade: {
        imageRef: `ghcr.io/nojv/grade@sha256:${"b".repeat(64)}`,
        imageSource: "registry" as const,
      },
      network: { mode: "none" as const },
      maxScore: 100,
    };
    problemFindById.mockResolvedValue({
      ...problem,
      type: "special_env",
      advancedConfig: config,
    });
    await expect(
      updateAdvancedJudgeConfiguration(ta, problem.id, {
        config,
        requiredPaths: [],
        retainedImageRefs: [config.run.imageRef],
      }),
    ).resolves.toBeUndefined();
    problemUpdate.mockClear();
    problemFindById.mockResolvedValue({
      ...problem,
      type: "special_env",
      advancedConfig: { ...config, run: config.grade },
    });
    await expect(
      updateAdvancedJudgeConfiguration(ta, problem.id, {
        config,
        requiredPaths: [],
        retainedImageRefs: [config.run.imageRef],
      }),
    ).rejects.toThrow(/changed during validation/);
    expect(problemUpdate).not.toHaveBeenCalled();
  });
});
