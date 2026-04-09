import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared repo stubs — hoisted so they can be referenced in the vi.mock
// factory below (vi.mock is hoisted above regular imports).
const {
  problemCreate,
  problemStatementCreate,
  problemFindById,
  problemUpdate,
  PRISMA_JSON_NULL
} = vi.hoisted(() => ({
  problemCreate: vi.fn(),
  problemStatementCreate: vi.fn(),
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
      withTx: () => ({
        deleteByProblemId: vi.fn(),
        createMany: vi.fn()
      })
    },
    testcaseSetRepo: { withTx: () => ({}) },
    testcaseRepo: { withTx: () => ({}) },
    advancedTestcaseRepo: { withTx: () => ({}) },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({})
  };
});

import { problemDomain } from "@nojv/domain";

const { createProblemDefinition } = problemDomain;

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
