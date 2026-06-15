import { beforeEach, describe, expect, it, vi } from "vitest";

const { putText, deleteBlob, problemFindById, problemUpdate } = vi.hoisted(() => ({
  putText: vi.fn(),
  deleteBlob: vi.fn(),
  problemFindById: vi.fn(),
  problemUpdate: vi.fn(),
}));

vi.mock("@nojv/storage", () => ({
  createStorageClient: vi.fn(() => ({})),
  putText,
  getText: vi.fn(),
  deleteBlob,
  deleteBlobsByPrefix: vi.fn(),
  checkerKey: (problemId: string) => `problems/${problemId}/validator/checker`,
  interactorKey: (problemId: string) => `problems/${problemId}/validator/interactor`,
  testcaseInputKey: vi.fn(),
  testcaseOutputKey: vi.fn(),
  testcaseInputFileKey: vi.fn(),
  workspaceFileKey: vi.fn(),
  problemPrefix: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  const withTx = () => ({
    findById: problemFindById,
    update: problemUpdate,
  });
  return {
    Prisma: {},
    runTransaction: async <T>(fn: (txClient: unknown) => Promise<T>): Promise<T> => fn({}),
    problemRepo: {
      findById: problemFindById,
      withTx,
    },
    problemStatementRepo: { withTx: () => ({ upsert: vi.fn() }) },
  };
});

import { problemDomain } from "@nojv/application";

const { saveProblemJudgeConfig } = problemDomain;

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
  });
  problemUpdate.mockResolvedValue({ id: "prob_1" });
  putText.mockResolvedValue(undefined);
  deleteBlob.mockResolvedValue(undefined);
});

describe("saveProblemJudgeConfig", () => {
  it("uploads the checker body to the canonical key and persists only the key", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", {
      judgeConfig: { type: "checker", checkerLanguage: "python" },
      checkerScript: "accept()\n",
    });

    expect(putText).toHaveBeenCalledWith({}, "problems/prob_1/validator/checker", "accept()\n");

    const persisted = problemUpdate.mock.calls[0]![1] as {
      judgeConfig: Record<string, unknown>;
    };
    expect(persisted.judgeConfig).toMatchObject({
      type: "checker",
      checkerKey: "problems/prob_1/validator/checker",
      checkerLanguage: "python",
    });
    expect(persisted.judgeConfig).not.toHaveProperty("checkerScript");
    expect(deleteBlob).toHaveBeenCalledWith({}, "problems/prob_1/validator/interactor");
  });

  it("uploads the interactor body for interactive judges", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", {
      judgeConfig: { type: "interactive", interactorLanguage: "cpp" },
      interactorScript: "// interactor\n",
    });

    expect(putText).toHaveBeenCalledWith(
      {},
      "problems/prob_1/validator/interactor",
      "// interactor\n",
    );
    const persisted = problemUpdate.mock.calls[0]![1] as {
      judgeConfig: Record<string, unknown>;
    };
    expect(persisted.judgeConfig).toMatchObject({
      type: "interactive",
      interactorKey: "problems/prob_1/validator/interactor",
      interactorLanguage: "cpp",
    });
    expect(persisted.judgeConfig).not.toHaveProperty("interactorScript");
  });

  it("standard judge uploads nothing and sweeps both blobs", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", {
      judgeConfig: { type: "standard" },
    });

    expect(putText).not.toHaveBeenCalled();
    const persisted = problemUpdate.mock.calls[0]![1] as {
      judgeConfig: Record<string, unknown>;
    };
    expect(persisted.judgeConfig).toEqual({ type: "standard" });
    expect(deleteBlob).toHaveBeenCalledWith({}, "problems/prob_1/validator/checker");
    expect(deleteBlob).toHaveBeenCalledWith({}, "problems/prob_1/validator/interactor");
  });

  it("standard judge persists the compare options (case sensitivity + float tolerance)", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", {
      judgeConfig: {
        type: "standard",
        compare: { caseSensitive: false, floatTolerance: 1e-6 },
      },
    });

    const persisted = problemUpdate.mock.calls[0]![1] as {
      judgeConfig: Record<string, unknown>;
    };
    expect(persisted.judgeConfig).toEqual({
      type: "standard",
      compare: { caseSensitive: false, floatTolerance: 1e-6 },
    });
  });

  it("clearing the checker body (empty string) drops the key and deletes the blob", async () => {
    await saveProblemJudgeConfig(actor, "prob_1", {
      judgeConfig: { type: "checker", checkerLanguage: "python" },
      checkerScript: "   ",
    });

    expect(putText).not.toHaveBeenCalled();
    const persisted = problemUpdate.mock.calls[0]![1] as {
      judgeConfig: Record<string, unknown>;
    };
    expect(persisted.judgeConfig).not.toHaveProperty("checkerKey");
    expect(deleteBlob).toHaveBeenCalledWith({}, "problems/prob_1/validator/checker");
  });
});
