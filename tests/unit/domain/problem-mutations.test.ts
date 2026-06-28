import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  problemCreate,
  problemStatementCreate,
  workspaceDeleteByProblemId,
  workspaceCreateMany,
  problemFindById,
  problemUpdate,
  problemUpdateAdvancedRequiredPaths,
  problemDelete,
  problemHasContextLinks,
  PRISMA_JSON_NULL,
} = vi.hoisted(() => ({
  problemCreate: vi.fn(),
  problemStatementCreate: vi.fn(),
  workspaceDeleteByProblemId: vi.fn(),
  workspaceCreateMany: vi.fn(),
  problemFindById: vi.fn(),
  problemUpdate: vi.fn(),
  problemUpdateAdvancedRequiredPaths: vi.fn(),
  problemDelete: vi.fn(),
  problemHasContextLinks: vi.fn(),
  PRISMA_JSON_NULL: Symbol("Prisma.JsonNull"),
}));

vi.mock("@nojv/storage", () => {
  return {
    createStorageClient: vi.fn(() => ({})),
    putText: vi.fn(() => Promise.resolve()),
    getText: vi.fn(() => Promise.resolve("")),
    deleteBlob: vi.fn(() => Promise.resolve()),
    deleteBlobsByPrefix: vi.fn(() => Promise.resolve()),
    testcaseInputKey: (problemId: string, testcaseId: string) =>
      `problems/${problemId}/testcases/${testcaseId}/input`,
    testcaseOutputKey: (problemId: string, testcaseId: string) =>
      `problems/${problemId}/testcases/${testcaseId}/output`,
    testcaseInputFileKey: (problemId: string, testcaseId: string, filename: string) =>
      `problems/${problemId}/testcases/${testcaseId}/files/${filename}`,
    workspaceFileKey: (problemId: string, fileId: string) =>
      `problems/${problemId}/workspace/${fileId}`,
    problemPrefix: (problemId: string) => `problems/${problemId}/`,
  };
});

vi.mock("@nojv/db", () => {
  const withTx = {
    create: problemCreate,
    findById: problemFindById,
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
      hasContextLinks: problemHasContextLinks,
      updateAdvancedRequiredPaths: problemUpdateAdvancedRequiredPaths,
    },
    problemStatementRepo: {
      withTx: () => statementWithTx,
    },
    problemWorkspaceFileRepo: {
      withTx: () => workspaceWithTx,
      findByProblemId: vi.fn().mockResolvedValue([]),
    },
    testcaseSetRepo: { withTx: () => ({}) },
    testcaseRepo: { withTx: () => ({}) },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
  };
});

import { ConflictError, problemDomain } from "@nojv/application";

const {
  createProblemDefinition,
  updateProblemWorkspace,
  updateAdvancedRequiredPaths,
  deleteProblemRecord,
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
      run: { imageRef: "ghcr.io/acme/ta:1.2.3", imageSource: "tarball" as const },
      grade: { imageRef: "ghcr.io/acme/ta:1.2.3", imageSource: "tarball" as const },
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

describe("updateAdvancedRequiredPaths — special_env type guard", () => {
  const actor = {
    userId: "usr_author",
    username: "author",
    platformRole: "teacher" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    problemUpdateAdvancedRequiredPaths.mockResolvedValue(undefined);
  });

  it("rejects non-empty paths on a non-special_env problem with ConflictError", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_full",
      authorId: "usr_author",
      type: "full_source",
    });

    await expect(
      updateAdvancedRequiredPaths(actor, "prob_full", ["src/main.c"]),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(problemUpdateAdvancedRequiredPaths).not.toHaveBeenCalled();
  });

  it("persists non-empty paths on a special_env problem", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_se",
      authorId: "usr_author",
      type: "special_env",
    });

    await expect(
      updateAdvancedRequiredPaths(actor, "prob_se", ["src/main.c", "src/"]),
    ).resolves.toBeUndefined();
    expect(problemUpdateAdvancedRequiredPaths).toHaveBeenCalledTimes(1);
    expect(problemUpdateAdvancedRequiredPaths).toHaveBeenCalledWith("prob_se", [
      "src/main.c",
      "src/",
    ]);
  });

  it("allows clearing (empty array) on a non-special_env problem — idempotent", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_full",
      authorId: "usr_author",
      type: "full_source",
    });

    await expect(updateAdvancedRequiredPaths(actor, "prob_full", [])).resolves.toBeUndefined();
    expect(problemUpdateAdvancedRequiredPaths).toHaveBeenCalledWith("prob_full", []);
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
  const ownedProblem = { id: "prob_1", authorId: "usr_author", visibility: "private" };

  beforeEach(() => {
    vi.clearAllMocks();
    problemFindById.mockResolvedValue(ownedProblem);
    problemDelete.mockResolvedValue(ownedProblem);
  });

  it("refuses to delete a problem still linked to a contest/exam/assignment", async () => {
    problemHasContextLinks.mockResolvedValue(true);

    await expect(deleteProblemRecord(actor, "prob_1")).rejects.toBeInstanceOf(ConflictError);
    expect(problemDelete).not.toHaveBeenCalled();
  });

  it("deletes a problem with no context links", async () => {
    problemHasContextLinks.mockResolvedValue(false);

    await expect(deleteProblemRecord(actor, "prob_1")).resolves.toBeDefined();
    expect(problemDelete).toHaveBeenCalledWith("prob_1");
  });
});
