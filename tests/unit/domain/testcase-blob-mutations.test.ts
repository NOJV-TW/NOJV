import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
  problemFindById,
  problemUpdate,
  putImmutableText,
  runTransaction,
  testcaseCreateMany,
  testcaseDelete,
  testcaseFindById,
  testcaseSetCount,
  testcaseSetCreate,
  testcaseSetDelete,
  testcaseSetFindById,
  testcaseSetMaxOrdinal,
  testcaseSetUpdate,
  testcaseUpdate,
} = vi.hoisted(() => ({
  commitStoragePointerSwap: vi.fn(),
  guardStorageObjectWrites: vi.fn(),
  problemFindById: vi.fn(),
  problemUpdate: vi.fn(),
  putImmutableText: vi.fn(),
  runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ testcaseSet: { update: testcaseSetUpdate } }),
  ),
  testcaseCreateMany: vi.fn(),
  testcaseDelete: vi.fn(),
  testcaseFindById: vi.fn(),
  testcaseSetCount: vi.fn(),
  testcaseSetCreate: vi.fn(),
  testcaseSetDelete: vi.fn(),
  testcaseSetFindById: vi.fn(),
  testcaseSetMaxOrdinal: vi.fn(),
  testcaseSetUpdate: vi.fn(),
  testcaseUpdate: vi.fn(),
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
  Prisma: {},
  runTransaction,
  problemRepo: {
    findById: problemFindById,
    withTx: () => ({
      findById: problemFindById,
      lockForUpdate: vi.fn(),
      update: problemUpdate,
    }),
  },
  testcaseSetRepo: {
    withTx: () => ({
      countByProblem: testcaseSetCount,
      create: testcaseSetCreate,
      delete: testcaseSetDelete,
      findById: testcaseSetFindById,
      maxOrdinalByProblem: testcaseSetMaxOrdinal,
    }),
  },
  testcaseRepo: {
    withTx: () => ({
      createMany: testcaseCreateMany,
      delete: testcaseDelete,
      findById: testcaseFindById,
      update: testcaseUpdate,
    }),
  },
}));

import {
  createProblemTestcaseSetRecord,
  deleteTestcaseRecord,
  deleteTestcaseSetRecord,
  updateTestcaseSetRecord,
  updateTestcaseRecord,
} from "../../../packages/application/src/problem/testcase";

const actor = {
  userId: "usr_author",
  username: "author",
  platformRole: "teacher" as const,
};
const oldInput = { key: "old/input", sha256: "b".repeat(64), size: 3 };
const oldOutput = { key: "old/output", sha256: "c".repeat(64), size: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  problemFindById.mockResolvedValue({ id: "prob_1", authorId: actor.userId });
  problemUpdate.mockResolvedValue({ id: "prob_1" });
  testcaseSetCount.mockResolvedValue(0);
  testcaseSetMaxOrdinal.mockResolvedValue({ _max: { ordinal: null } });
  testcaseSetCreate.mockResolvedValue({ id: "set_1", name: "sample", problemId: "prob_1" });
  testcaseSetFindById.mockResolvedValue({
    id: "set_1",
    problemId: "prob_1",
    testcases: [],
  });
  testcaseFindById.mockResolvedValue({
    id: "tc_1",
    inputStorage: oldInput,
    outputStorage: oldOutput,
    inputFileStorage: null,
    testcaseSet: { problemId: "prob_1" },
  });
  putImmutableText.mockImplementation(
    async (_client: unknown, key: string, content: string) => ({
      key,
      sha256: "a".repeat(64),
      size: Buffer.byteLength(content),
    }),
  );
  guardStorageObjectWrites.mockResolvedValue(undefined);
  commitStoragePointerSwap.mockResolvedValue(undefined);
  testcaseSetUpdate.mockResolvedValue({ id: "set_1" });
});

const mutationCalls = [
  () =>
    createProblemTestcaseSetRecord(actor, "prob_1", {
      name: "sample",
      weight: 1,
      description: "",
      cases: [{ input: "1", output: "1" }],
    }),
  () => updateTestcaseSetRecord(actor, "prob_1", "set_1", { name: "renamed" }),
  () => deleteTestcaseSetRecord(actor, "prob_1", "set_1"),
  () => updateTestcaseRecord(actor, "prob_1", "tc_1", { input: "new" }),
  () => deleteTestcaseRecord(actor, "prob_1", "tc_1"),
] as const;

function expectNoMutationSideEffects() {
  expect(runTransaction).not.toHaveBeenCalled();
  expect(guardStorageObjectWrites).not.toHaveBeenCalled();
  expect(putImmutableText).not.toHaveBeenCalled();
  expect(commitStoragePointerSwap).not.toHaveBeenCalled();
}

describe("testcase immutable object mutations", () => {
  it.each([
    ["a non-owner", { id: "prob_1", authorId: "usr_other" }, /author or an admin/i],
    ["an absent problem", null, /problem not found/i],
  ])(
    "rejects every testcase mutation for %s before storage or transaction side effects",
    async (_label, problem, error) => {
      for (const mutate of mutationCalls) {
        problemFindById.mockResolvedValue(problem);
        await expect(mutate()).rejects.toThrow(error);
        expectNoMutationSideEffects();
        vi.clearAllMocks();
      }
    },
  );

  it("stages versioned objects before inserting pointer rows and cancels their guards on commit", async () => {
    await createProblemTestcaseSetRecord(actor, "prob_1", {
      name: "sample",
      weight: 1,
      description: "",
      cases: [{ input: "1 1", output: "2" }],
    });

    const rows = testcaseCreateMany.mock.calls[0]![0] as Array<{
      inputStorage: { key: string };
      outputStorage: { key: string };
    }>;
    expect(rows[0]!.inputStorage.key).toMatch(
      /^problems\/prob_1\/testcases\/[^/]+\/versions\/[^/]+\/input$/,
    );
    expect(rows[0]!.outputStorage.key).toMatch(
      /^problems\/prob_1\/testcases\/[^/]+\/versions\/[^/]+\/output$/,
    );
    expect(commitStoragePointerSwap).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ added: [rows[0]!.inputStorage, rows[0]!.outputStorage] }),
    );
    expect(problemFindById).toHaveBeenCalledTimes(2);
  });

  it("rechecks ownership after locking even when the side-effect-free check passed", async () => {
    problemFindById
      .mockResolvedValueOnce({ id: "prob_1", authorId: actor.userId })
      .mockResolvedValueOnce({ id: "prob_1", authorId: "usr_other" });

    await expect(
      createProblemTestcaseSetRecord(actor, "prob_1", {
        name: "sample",
        weight: 1,
        description: "",
        cases: [{ input: "1", output: "1" }],
      }),
    ).rejects.toThrow(/author or an admin/i);

    expect(putImmutableText).toHaveBeenCalledTimes(2);
    expect(testcaseSetCreate).not.toHaveBeenCalled();
    expect(commitStoragePointerSwap).not.toHaveBeenCalled();
  });

  it("does not insert DB rows when immutable upload fails", async () => {
    putImmutableText.mockRejectedValueOnce(new Error("S3 unavailable"));
    await expect(
      createProblemTestcaseSetRecord(actor, "prob_1", {
        name: "sample",
        weight: 1,
        description: "",
        cases: [{ input: "1", output: "1" }],
      }),
    ).rejects.toThrow("S3 unavailable");
    expect(testcaseSetCreate).not.toHaveBeenCalled();
  });

  it("atomically swaps a changed input pointer and schedules the old pointer", async () => {
    await updateTestcaseRecord(actor, "prob_1", "tc_1", { input: "new" });
    const data = testcaseUpdate.mock.calls[0]![1] as { inputStorage: { key: string } };
    expect(data.inputStorage.key).toMatch(/\/versions\/[^/]+\/input$/);
    expect(commitStoragePointerSwap).toHaveBeenCalledWith(expect.anything(), {
      added: [data.inputStorage],
      removed: [oldInput],
    });
  });

  it("deletes the row and schedules every exact object pointer in the transaction", async () => {
    await deleteTestcaseRecord(actor, "prob_1", "tc_1");
    expect(testcaseDelete).toHaveBeenCalledWith("tc_1");
    expect(commitStoragePointerSwap).toHaveBeenCalledWith(expect.anything(), {
      added: [],
      removed: [oldInput, oldOutput],
    });
  });

  it("rejects cross-problem testcase and set IDs before DB deletion", async () => {
    testcaseFindById.mockResolvedValueOnce({
      id: "tc_other",
      testcaseSet: { problemId: "prob_other" },
    });
    await expect(deleteTestcaseRecord(actor, "prob_1", "tc_other")).rejects.toThrow(
      /not found for this problem/i,
    );
    testcaseSetFindById.mockResolvedValueOnce({
      id: "set_other",
      problemId: "prob_other",
      testcases: [],
    });
    await expect(deleteTestcaseSetRecord(actor, "prob_1", "set_other")).rejects.toThrow(
      /not found for this problem/i,
    );
  });
});
