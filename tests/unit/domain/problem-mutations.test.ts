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
  PRISMA_JSON_NULL
} = vi.hoisted(() => ({
  problemCreate: vi.fn(),
  problemStatementCreate: vi.fn(),
  workspaceDeleteByProblemId: vi.fn(),
  workspaceCreateMany: vi.fn(),
  problemFindById: vi.fn(),
  problemUpdate: vi.fn(),
  // Sentinel for Prisma.JsonNull — we only need identity equality in assertions.
  PRISMA_JSON_NULL: Symbol("Prisma.JsonNull")
}));

vi.mock("@nojv/db", () => {
  const withTx = {
    create: problemCreate,
    findById: problemFindById,
    update: problemUpdate,
    delete: vi.fn()
  };
  const statementWithTx = {
    create: problemStatementCreate,
    upsert: vi.fn()
  };
  const workspaceWithTx = {
    deleteByProblemId: workspaceDeleteByProblemId,
    createMany: workspaceCreateMany
  };
  return {
    Prisma: {
      JsonNull: PRISMA_JSON_NULL
    },
    problemRepo: {
      withTx: () => withTx,
      findById: problemFindById,
      delete: vi.fn()
    },
    problemStatementRepo: {
      withTx: () => statementWithTx
    },
    problemWorkspaceFileRepo: {
      withTx: () => workspaceWithTx
    },
    testcaseSetRepo: { withTx: () => ({}) },
    testcaseRepo: { withTx: () => ({}) },
    advancedTestcaseRepo: { withTx: () => ({}) },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({})
  };
});

import { ConflictError, problemDomain } from "@nojv/domain";

const { createProblemDefinition, updateProblemWorkspace } = problemDomain;

const fakeTx = {} as never;

const baseInput = {
  authorId: "usr_1",
  difficulty: "easy" as const,
  summary: "",
  title: "Test Problem"
};

describe("createProblemDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    problemCreate.mockResolvedValue({ id: "prob_1" });
  });

  it("defaults mode to standard and leaves advanced fields null", async () => {
    await createProblemDefinition(fakeTx, baseInput);

    expect(problemCreate).toHaveBeenCalledTimes(1);
    const data = problemCreate.mock.calls[0][0];
    expect(data.mode).toBe("standard");
    expect(data.samples).toBe(PRISMA_JSON_NULL);
    expect(data.advancedImageRef).toBeUndefined();
    expect(data.advancedImageSource).toBeUndefined();
    expect(data.advancedResourceLimits).toBe(PRISMA_JSON_NULL);
  });

  it("honors mode: 'advanced' explicitly passed by the caller", async () => {
    await createProblemDefinition(fakeTx, { ...baseInput, mode: "advanced" });

    const data = problemCreate.mock.calls[0][0];
    expect(data.mode).toBe("advanced");
  });

  it("applies advanced defaults when mode is advanced and fields omitted", async () => {
    await createProblemDefinition(fakeTx, { ...baseInput, mode: "advanced" });

    const data = problemCreate.mock.calls[0][0];
    expect(data.advancedImageRef).toBe("");
    expect(data.advancedImageSource).toBe("registry");
    expect(data.advancedResourceLimits).toEqual({
      totalTimeMs: 30_000,
      memoryMb: 512,
      networkEnabled: false
    });
  });

  it("preserves caller-supplied advanced fields when provided", async () => {
    await createProblemDefinition(fakeTx, {
      ...baseInput,
      mode: "advanced",
      advancedImageRef: "ghcr.io/acme/ta:1.2.3",
      advancedImageSource: "tarball",
      advancedResourceLimits: {
        totalTimeMs: 60_000,
        memoryMb: 1024,
        networkEnabled: true
      }
    });

    const data = problemCreate.mock.calls[0][0];
    expect(data.advancedImageRef).toBe("ghcr.io/acme/ta:1.2.3");
    expect(data.advancedImageSource).toBe("tarball");
    expect(data.advancedResourceLimits).toEqual({
      totalTimeMs: 60_000,
      memoryMb: 1024,
      networkEnabled: true
    });
  });
});

describe("updateProblemWorkspace — 1 MB per-language quota", () => {
  const actor = {
    userId: "usr_author",
    username: "author",
    platformRole: "teacher" as const
  };

  beforeEach(() => {
    vi.clearAllMocks();
    problemFindById.mockResolvedValue({
      id: "prob_1",
      authorId: "usr_author",
      judgeConfig: null
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
            editableRegions: null
          }
        ]
      })
    ).resolves.toEqual({ id: "prob_1", fileCount: 1 });
    expect(workspaceCreateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects when a single language exceeds 1 MB across multiple files", async () => {
    // Two python files, each ~600 KB → ~1.2 MB total for python.
    const chunk = "a".repeat(600_000);
    // Round 4 regression: this threw plain `new Error(...)` which became
    // HTTP 500 instead of 409. Assert the error class explicitly so a
    // future change back to `Error` fails loudly.
    await expect(
      updateProblemWorkspace(actor, "prob_1", {
        files: [
          {
            language: "python",
            path: "a.py",
            content: chunk,
            visibility: "editable",
            editableRegions: null
          },
          {
            language: "python",
            path: "b.py",
            content: chunk,
            visibility: "editable",
            editableRegions: null
          }
        ]
      })
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
            path: "a.py",
            content: pythonChunk,
            visibility: "editable",
            editableRegions: null
          },
          {
            language: "cpp",
            path: "a.cpp",
            content: cppChunk,
            visibility: "editable",
            editableRegions: null
          }
        ]
      })
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
            path: "a.py",
            content: pythonChunk,
            visibility: "editable",
            editableRegions: null
          },
          {
            language: "cpp",
            path: "a.cpp",
            content: cppBig,
            visibility: "editable",
            editableRegions: null
          }
        ]
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("over-budget error carries the per-language byte count in its message", async () => {
    const chunk = "a".repeat(1_100_000);
    await expect(
      updateProblemWorkspace(actor, "prob_1", {
        files: [
          {
            language: "python",
            path: "a.py",
            content: chunk,
            visibility: "editable",
            editableRegions: null
          }
        ]
      })
    ).rejects.toThrow(/python.*1 MB limit.*1100000 bytes/);
  });
});
