import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
  problemFindById,
  problemUpdate,
  putImmutableText,
} = vi.hoisted(() => ({
  commitStoragePointerSwap: vi.fn(),
  guardStorageObjectWrites: vi.fn(),
  problemFindById: vi.fn(),
  problemUpdate: vi.fn(),
  putImmutableText: vi.fn(),
}));

vi.mock("@nojv/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@nojv/storage")>();
  return { ...original, createStorageClient: vi.fn(() => ({})), putImmutableText };
});

vi.mock("../../../packages/application/src/shared/storage-object-lifecycle", () => ({
  commitStoragePointerSwap,
  guardStorageObjectWrites,
}));

vi.mock("@nojv/db", () => ({
  Prisma: { DbNull: { __dbNull: true } },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
  problemRepo: {
    findById: problemFindById,
    withTx: () => ({
      findById: problemFindById,
      lockForUpdate: vi.fn(),
      update: problemUpdate,
    }),
  },
  problemStatementRepo: { withTx: () => ({ upsert: vi.fn() }) },
}));

import { saveProblemJudgeConfig } from "../../../packages/application/src/problem/mutations";

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
    type: "full_source",
    advancedConfig: null,
    checkerStorage: null,
    interactorStorage: null,
  });
  problemUpdate.mockResolvedValue({ id: "prob_1" });
  putImmutableText.mockImplementation(
    async (_client: unknown, key: string, content: string) => ({
      key,
      sha256: "a".repeat(64),
      size: Buffer.byteLength(content),
    }),
  );
  commitStoragePointerSwap.mockResolvedValue(undefined);
  guardStorageObjectWrites.mockResolvedValue(undefined);
});

describe("saveProblemJudgeConfig", () => {
  it("uploads a versioned checker and persists its immutable pointer", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", {
      judgeConfig: { type: "checker", checkerLanguage: "python" },
      checkerScript: "accept()\n",
    });

    expect(putImmutableText).toHaveBeenCalledWith(
      {},
      expect.stringMatching(/^problems\/prob_1\/validators\/[^/]+\/checker$/),
      "accept()\n",
    );
    const persisted = problemUpdate.mock.calls[0]![1] as {
      judgeConfig: Record<string, unknown>;
      checkerStorage: { key: string };
    };
    expect(persisted.judgeConfig).toEqual({ type: "checker", checkerLanguage: "python" });
    expect(persisted.judgeConfig).not.toHaveProperty("checkerKey");
    expect(persisted.checkerStorage.key).toMatch(/\/validators\/[^/]+\/checker$/);
  });

  it("uploads a versioned interactor for interactive judges", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", {
      judgeConfig: { type: "interactive", interactorLanguage: "cpp" },
      interactorScript: "// interactor\n",
    });
    expect(putImmutableText).toHaveBeenCalledWith(
      {},
      expect.stringMatching(/^problems\/prob_1\/validators\/[^/]+\/interactor$/),
      "// interactor\n",
    );
    const persisted = problemUpdate.mock.calls[0]![1] as {
      judgeConfig: Record<string, unknown>;
    };
    expect(persisted.judgeConfig).toEqual({
      type: "interactive",
      interactorLanguage: "cpp",
    });
  });

  it("standard judge uploads nothing and clears pointer columns in the same transaction", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", { judgeConfig: { type: "standard" } });
    expect(putImmutableText).not.toHaveBeenCalled();
    expect(problemUpdate.mock.calls[0]![1]).toMatchObject({
      judgeConfig: { type: "standard" },
      activeStorageBytes: { increment: 0 },
    });
    expect(commitStoragePointerSwap).toHaveBeenCalledWith(expect.anything(), {
      added: [],
      removed: [],
    });
  });

  it("persists standard compare options without storage-derived config keys", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", {
      judgeConfig: {
        type: "standard",
        compare: { caseSensitive: false, floatTolerance: 1e-6 },
      },
    });
    expect(problemUpdate.mock.calls[0]![1].judgeConfig).toEqual({
      type: "standard",
      compare: { caseSensitive: false, floatTolerance: 1e-6 },
    });
  });
});
