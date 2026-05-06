import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared repo stubs — hoisted so they can be referenced in the vi.mock
// factory below (vi.mock is hoisted above regular imports).
const {
  problemCreate,
  problemStatementCreate,
  workspaceDeleteByProblemId,
  workspaceCreateMany,
  problemFindById,
  problemUpdate,
  problemUpdateAdvancedRequiredPaths,
  PRISMA_JSON_NULL,
} = vi.hoisted(() => ({
  problemCreate: vi.fn(),
  problemStatementCreate: vi.fn(),
  workspaceDeleteByProblemId: vi.fn(),
  workspaceCreateMany: vi.fn(),
  problemFindById: vi.fn(),
  problemUpdate: vi.fn(),
  problemUpdateAdvancedRequiredPaths: vi.fn(),
  // Sentinel for Prisma.JsonNull — we only need identity equality in assertions.
  PRISMA_JSON_NULL: Symbol("Prisma.JsonNull"),
}));

vi.mock("@nojv/storage", () => {
  // Lazy stub: domain code only uses these primitives. We don't care about
  // the actual values here — `updateProblemWorkspace` writes blobs before
  // INSERT and the test only asserts the DB-side effects.
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
      delete: vi.fn(),
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

import { ConflictError, problemDomain } from "@nojv/domain";

const { createProblemDefinition, updateProblemWorkspace, updateAdvancedRequiredPaths } =
  problemDomain;

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

  it("defaults type to full_source and leaves special_env fields unset", async () => {
    await createProblemDefinition(fakeTx, baseInput);

    expect(problemCreate).toHaveBeenCalledTimes(1);
    const data = problemCreate.mock.calls[0][0];
    expect(data.type).toBe("full_source");
    expect(data.samples).toBe(PRISMA_JSON_NULL);
    expect(data.advancedImageRef).toBeUndefined();
    expect(data.advancedImageSource).toBeUndefined();
  });

  it("honors type: 'special_env' explicitly passed by the caller", async () => {
    await createProblemDefinition(fakeTx, { ...baseInput, type: "special_env" });

    const data = problemCreate.mock.calls[0][0];
    expect(data.type).toBe("special_env");
  });

  it("applies special_env defaults when type is special_env and fields omitted", async () => {
    await createProblemDefinition(fakeTx, { ...baseInput, type: "special_env" });

    const data = problemCreate.mock.calls[0][0];
    expect(data.advancedImageRef).toBe("");
    expect(data.advancedImageSource).toBe("registry");
  });

  it("preserves caller-supplied special_env fields when provided", async () => {
    await createProblemDefinition(fakeTx, {
      ...baseInput,
      type: "special_env",
      advancedImageRef: "ghcr.io/acme/ta:1.2.3",
      advancedImageSource: "tarball",
    });

    const data = problemCreate.mock.calls[0][0];
    expect(data.advancedImageRef).toBe("ghcr.io/acme/ta:1.2.3");
    expect(data.advancedImageSource).toBe("tarball");
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
    // main.py (required) + two big python files → > 1 MB total for python.
    const chunk = "a".repeat(600_000);
    // Round 4 regression: this threw plain `new Error(...)` which became
    // HTTP 500 instead of 409. Assert the error class explicitly so a
    // future change back to `Error` fails loudly.
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
    // Python stays well under budget, cpp goes over.
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
    // problemUpdateSchema.partial() drops the create-time superRefine arm,
    // so the canonical guard for partial updates lives in the mutation
    // itself. This is the regression test for that guard.
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
    // Clearing must always succeed regardless of type so that callers can
    // safely call this on any problem to reset the column.
    problemFindById.mockResolvedValue({
      id: "prob_full",
      authorId: "usr_author",
      type: "full_source",
    });

    await expect(updateAdvancedRequiredPaths(actor, "prob_full", [])).resolves.toBeUndefined();
    expect(problemUpdateAdvancedRequiredPaths).toHaveBeenCalledWith("prob_full", []);
  });
});
