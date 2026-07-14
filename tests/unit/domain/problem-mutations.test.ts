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
  putImmutableText,
  commitStoragePointerSwap,
  guardStorageObjectWrites,
  submissionFindMany,
  userFindById,
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
  putImmutableText: vi.fn(),
  commitStoragePointerSwap: vi.fn(),
  guardStorageObjectWrites: vi.fn(),
  submissionFindMany: vi.fn(),
  userFindById: vi.fn(),
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
  };
  const statementWithTx = {
    create: problemStatementCreate,
    upsert: vi.fn(),
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
    testcaseSetRepo: { withTx: () => ({}) },
    testcaseRepo: { withTx: () => ({}) },
    submissionRepo: { findMany: submissionFindMany },
    userRepo: { findById: userFindById },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({
        problem: {
          findUnique: problemFindById,
          findFirst: problemFindLinked,
          delete: problemDelete,
        },
      }),
  };
});

import { ConflictError, problemDomain } from "@nojv/application";

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
