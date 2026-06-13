import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  putText,
  getText,
  deleteBlob,
  deleteBlobsByPrefix,
  testcaseFindById,
  testcaseRowFindById,
  testcaseSetCreate,
  testcaseCreateMany,
  testcaseDelete,
  testcaseSetDelete,
  testcaseSetCount,
  testcaseSetMaxOrdinal,
  problemFindById,
} = vi.hoisted(() => ({
  putText: vi.fn(),
  getText: vi.fn(),
  deleteBlob: vi.fn(),
  deleteBlobsByPrefix: vi.fn(),
  testcaseFindById: vi.fn(),
  testcaseRowFindById: vi.fn(),
  testcaseSetCreate: vi.fn(),
  testcaseCreateMany: vi.fn(),
  testcaseDelete: vi.fn(),
  testcaseSetDelete: vi.fn(),
  testcaseSetCount: vi.fn(),
  testcaseSetMaxOrdinal: vi.fn(),
  problemFindById: vi.fn(),
}));

vi.mock("@nojv/storage", () => ({
  createStorageClient: vi.fn(() => ({})),
  putText,
  getText,
  deleteBlob,
  deleteBlobsByPrefix,
  testcaseInputKey: (problemId: string, testcaseId: string) =>
    `problems/${problemId}/testcases/${testcaseId}/input`,
  testcaseOutputKey: (problemId: string, testcaseId: string) =>
    `problems/${problemId}/testcases/${testcaseId}/output`,
  testcaseInputFileKey: (problemId: string, testcaseId: string, filename: string) =>
    `problems/${problemId}/testcases/${testcaseId}/files/${filename}`,
  workspaceFileKey: (problemId: string, fileId: string) =>
    `problems/${problemId}/workspace/${fileId}`,
  problemPrefix: (problemId: string) => `problems/${problemId}/`,
}));

vi.mock("@nojv/db", () => {
  const tx = {
    testcaseSet: {
      count: testcaseSetCount,
      aggregate: testcaseSetMaxOrdinal,
    },
    problem: {
      findUnique: problemFindById,
    },
  };

  return {
    Prisma: {},
    runTransaction: async <T>(fn: (txClient: unknown) => Promise<T>): Promise<T> => fn(tx),
    problemRepo: {
      withTx: () => ({
        findById: problemFindById,
      }),
    },
    testcaseSetRepo: {
      findById: testcaseFindById,
      delete: testcaseSetDelete,
      withTx: () => ({
        create: testcaseSetCreate,
        countByProblem: testcaseSetCount,
        maxOrdinalByProblem: testcaseSetMaxOrdinal,
      }),
    },
    testcaseRepo: {
      findById: testcaseRowFindById,
      delete: testcaseDelete,
      withTx: () => ({
        createMany: testcaseCreateMany,
      }),
    },
  };
});

import { problemDomain } from "@nojv/application";

const {
  createProblemTestcaseSetRecord,
  updateTestcaseRecord,
  deleteTestcaseRecord,
  deleteTestcaseSetRecord,
} = problemDomain;

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
  testcaseSetCount.mockResolvedValue(0);
  testcaseSetMaxOrdinal.mockResolvedValue({ _max: { ordinal: null } });
  testcaseSetCreate.mockResolvedValue({
    id: "set_1",
    name: "sample",
    problemId: "prob_1",
  });
  testcaseCreateMany.mockResolvedValue({ count: 1 });
  putText.mockResolvedValue(undefined);
  deleteBlob.mockResolvedValue(undefined);
  deleteBlobsByPrefix.mockResolvedValue(undefined);
  testcaseDelete.mockResolvedValue({ id: "tc_1" });
  testcaseSetDelete.mockResolvedValue({ id: "set_1" });
  testcaseFindById.mockResolvedValue({
    id: "set_1",
    problemId: "prob_1",
    testcases: [],
  });
  testcaseRowFindById.mockResolvedValue({
    id: "tc_1",
    testcaseSet: { problemId: "prob_1" },
  });
});

describe("createProblemTestcaseSetRecord", () => {
  it("writes every blob to S3 BEFORE the DB INSERT", async () => {
    const sequence: string[] = [];
    putText.mockImplementation(async () => {
      sequence.push("put");
    });
    testcaseCreateMany.mockImplementation(async () => {
      sequence.push("createMany");
      return { count: 2 };
    });

    await createProblemTestcaseSetRecord(actor, "prob_1", {
      name: "sample",
      weight: 1,
      description: "",
      cases: [
        { input: "1 2", output: "3" },
        { input: "5 5", output: "10" },
      ],
    });

    expect(putText).toHaveBeenCalledTimes(4);
    expect(sequence.filter((s) => s === "put")).toHaveLength(4);
    expect(sequence.indexOf("createMany")).toBeGreaterThan(sequence.lastIndexOf("put"));
    expect(testcaseCreateMany).toHaveBeenCalledTimes(1);
  });

  it("propagates S3 errors and never touches the DB on upload failure", async () => {
    putText.mockRejectedValueOnce(new Error("S3 503 Service Unavailable"));

    await expect(
      createProblemTestcaseSetRecord(actor, "prob_1", {
        name: "sample",
        weight: 1,
        description: "",
        cases: [{ input: "1", output: "1" }],
      }),
    ).rejects.toThrow(/S3 503/);

    expect(testcaseSetCreate).not.toHaveBeenCalled();
    expect(testcaseCreateMany).not.toHaveBeenCalled();
  });

  it("propagates DB failure (S3 objects become orphans, no automatic rollback)", async () => {
    testcaseCreateMany.mockRejectedValueOnce(new Error("unique constraint violation"));

    await expect(
      createProblemTestcaseSetRecord(actor, "prob_1", {
        name: "sample",
        weight: 1,
        description: "",
        cases: [{ input: "1", output: "1" }],
      }),
    ).rejects.toThrow(/unique constraint/);

    expect(putText).toHaveBeenCalled();
  });

  it("inserts rows whose key columns reference the freshly uploaded blobs", async () => {
    await createProblemTestcaseSetRecord(actor, "prob_1", {
      name: "sample",
      weight: 1,
      description: "",
      cases: [{ input: "1 1", output: "2" }],
    });

    expect(testcaseCreateMany).toHaveBeenCalledTimes(1);
    const rows = testcaseCreateMany.mock.calls[0]![0] as Array<{
      id: string;
      inputKey: string;
      outputKey: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.inputKey).toMatch(
      new RegExp(`^problems/prob_1/testcases/${rows[0]!.id}/input$`),
    );
    expect(rows[0]!.outputKey).toMatch(
      new RegExp(`^problems/prob_1/testcases/${rows[0]!.id}/output$`),
    );
  });
});

describe("updateTestcaseRecord", () => {
  it("overwrites only the input blob when only `input` is provided", async () => {
    await updateTestcaseRecord(actor, "prob_1", "tc_1", { input: "new" });

    expect(putText).toHaveBeenCalledTimes(1);
    expect(putText).toHaveBeenCalledWith(
      expect.anything(),
      "problems/prob_1/testcases/tc_1/input",
      "new",
    );
  });

  it("overwrites both blobs when both fields are provided", async () => {
    await updateTestcaseRecord(actor, "prob_1", "tc_1", { input: "i", output: "o" });

    expect(putText).toHaveBeenCalledTimes(2);
  });

  it("does not touch the DB row (key columns are stable for the lifetime of the row)", async () => {
    await updateTestcaseRecord(actor, "prob_1", "tc_1", { input: "x" });

    expect(testcaseCreateMany).not.toHaveBeenCalled();
  });
});

describe("deleteTestcaseRecord", () => {
  it("deletes the DB row first, then sweeps S3 (best effort)", async () => {
    const sequence: string[] = [];
    testcaseDelete.mockImplementation(async () => {
      sequence.push("db");
      return { id: "tc_1" };
    });
    deleteBlobsByPrefix.mockImplementation(async () => {
      sequence.push("s3");
    });

    await deleteTestcaseRecord(actor, "prob_1", "tc_1");

    expect(sequence).toEqual(["db", "s3"]);
  });

  it("propagates DB delete errors (S3 cleanup never runs)", async () => {
    testcaseDelete.mockRejectedValueOnce(new Error("FK violation"));

    await expect(deleteTestcaseRecord(actor, "prob_1", "tc_1")).rejects.toThrow(/FK violation/);
    expect(deleteBlobsByPrefix).not.toHaveBeenCalled();
  });

  it("swallows S3 cleanup errors so the user-facing delete still succeeds", async () => {
    deleteBlobsByPrefix.mockRejectedValueOnce(new Error("S3 down"));

    await expect(deleteTestcaseRecord(actor, "prob_1", "tc_1")).resolves.not.toThrow();
    expect(testcaseDelete).toHaveBeenCalledTimes(1);
  });
});

describe("object-level authorization — set/testcase must belong to the route problem", () => {
  it("rejects deleting a testcase whose set belongs to another problem (IDOR)", async () => {
    testcaseRowFindById.mockResolvedValueOnce({
      id: "tc_other",
      testcaseSet: { problemId: "prob_OTHER" },
    });

    await expect(deleteTestcaseRecord(actor, "prob_1", "tc_other")).rejects.toThrow(
      /not found for this problem/i,
    );
    expect(testcaseDelete).not.toHaveBeenCalled();
  });

  it("rejects deleting a testcase set that belongs to another problem (IDOR)", async () => {
    testcaseFindById.mockResolvedValueOnce({
      id: "set_other",
      problemId: "prob_OTHER",
      testcases: [{ id: "tc_x" }],
    });

    await expect(deleteTestcaseSetRecord(actor, "prob_1", "set_other")).rejects.toThrow(
      /not found for this problem/i,
    );
    expect(testcaseSetDelete).not.toHaveBeenCalled();
  });

  it("rejects overwriting a testcase blob across problems (no S3 write)", async () => {
    testcaseRowFindById.mockResolvedValueOnce({
      id: "tc_other",
      testcaseSet: { problemId: "prob_OTHER" },
    });

    await expect(
      updateTestcaseRecord(actor, "prob_1", "tc_other", { input: "x" }),
    ).rejects.toThrow(/not found for this problem/i);
    expect(putText).not.toHaveBeenCalled();
  });
});

describe("deleteTestcaseSetRecord", () => {
  it("sweeps S3 prefixes for every testcase in the set after the DB delete commits", async () => {
    testcaseFindById.mockResolvedValueOnce({
      id: "set_1",
      problemId: "prob_1",
      testcases: [{ id: "tc_a" }, { id: "tc_b" }, { id: "tc_c" }],
    });

    await deleteTestcaseSetRecord(actor, "prob_1", "set_1");

    expect(testcaseSetDelete).toHaveBeenCalledWith("set_1");
    expect(deleteBlobsByPrefix).toHaveBeenCalledTimes(3);
    const sweptPrefixes = deleteBlobsByPrefix.mock.calls
      .map((call) => call[1] as string)
      .sort();
    expect(sweptPrefixes).toEqual([
      "problems/prob_1/testcases/tc_a/",
      "problems/prob_1/testcases/tc_b/",
      "problems/prob_1/testcases/tc_c/",
    ]);
  });
});
