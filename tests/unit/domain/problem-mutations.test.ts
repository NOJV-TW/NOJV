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
      withTx: () => workspaceWithTx,
      findByProblemId: vi.fn().mockResolvedValue([])
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
  title: "Test Problem"
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
    expect(data.networkEnabled).toBe(false);
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
    expect(data.networkEnabled).toBe(false);
  });

  it("preserves caller-supplied special_env fields when provided", async () => {
    await createProblemDefinition(fakeTx, {
      ...baseInput,
      type: "special_env",
      advancedImageRef: "ghcr.io/acme/ta:1.2.3",
      advancedImageSource: "tarball",
      networkEnabled: true
    });

    const data = problemCreate.mock.calls[0][0];
    expect(data.advancedImageRef).toBe("ghcr.io/acme/ta:1.2.3");
    expect(data.advancedImageSource).toBe("tarball");
    expect(data.networkEnabled).toBe(true);
  });

  it("merges difficulty into the tag list", async () => {
    await createProblemDefinition(fakeTx, {
      ...baseInput,
      difficulty: "hard",
      tags: ["graph", "dp"]
    });

    const data = problemCreate.mock.calls[0][0];
    // Difficulty tag is prepended; pre-existing non-difficulty tags follow.
    expect(data.tags).toEqual(["hard", "graph", "dp"]);
  });

  it("strips a stale difficulty tag from the input list before re-adding the canonical one", async () => {
    await createProblemDefinition(fakeTx, {
      ...baseInput,
      difficulty: "medium",
      tags: ["easy", "graph"]
    });

    const data = problemCreate.mock.calls[0][0];
    // The "easy" passed in tags is stripped; "medium" from difficulty wins.
    expect(data.tags).toEqual(["medium", "graph"]);
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
            editableRegions: null
          },
          {
            language: "python",
            path: "big_a.py",
            content: chunk,
            visibility: "editable",
            editableRegions: null
          },
          {
            language: "python",
            path: "big_b.py",
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
            path: "main.py",
            content: pythonChunk,
            visibility: "editable",
            editableRegions: null
          },
          {
            language: "cpp",
            path: "main.cpp",
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
            path: "main.py",
            content: pythonChunk,
            visibility: "editable",
            editableRegions: null
          },
          {
            language: "cpp",
            path: "main.cpp",
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
            path: "main.py",
            content: chunk,
            visibility: "editable",
            editableRegions: null
          }
        ]
      })
    ).rejects.toThrow(/python.*1 MB limit.*1100000 bytes/);
  });
});
