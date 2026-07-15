import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  problemFindById,
  problemTxFindById,
  problemUpdate,
  workspaceDelete,
  testcaseSetDelete,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  problemTxFindById: vi.fn(),
  problemUpdate: vi.fn(),
  workspaceDelete: vi.fn(),
  testcaseSetDelete: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  Prisma: { DbNull: null },
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  problemRepo: {
    findById: problemFindById,
    withTx: () => ({
      findById: problemTxFindById,
      lockForUpdate: vi.fn(),
      update: problemUpdate,
    }),
  },
  problemWorkspaceFileRepo: {
    withTx: () => ({
      createMany: vi.fn(),
      deleteByProblemId: workspaceDelete,
      findByProblemId: vi.fn().mockResolvedValue([]),
    }),
  },
  testcaseRepo: { withTx: () => ({ createMany: vi.fn() }) },
  testcaseSetRepo: {
    withTx: () => ({
      create: vi.fn(),
      deleteByProblemId: testcaseSetDelete,
      findByProblemId: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => ({}),
}));
vi.mock("../../../packages/application/src/shared/storage-object-lifecycle", () => ({
  commitStoragePointerSwap: vi.fn(),
  guardStorageObjectWrites: vi.fn(),
}));

const { importBundle } = await import("../../../packages/application/src/problem/bundle");

const actor = {
  userId: "usr_author",
  username: "author",
  platformRole: "teacher" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  problemFindById.mockResolvedValue({ id: "prob_1", authorId: actor.userId });
  problemTxFindById.mockResolvedValue({
    id: "prob_1",
    authorId: "usr_other",
    judgeConfig: { type: "standard" },
  });
});

describe("problem bundle authorization", () => {
  it("rechecks ownership after locking before replacing testcase data", async () => {
    const zip = new JSZip();
    const bundle = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));

    await expect(importBundle(actor, "prob_1", bundle)).rejects.toThrow(/author or an admin/i);

    expect(testcaseSetDelete).not.toHaveBeenCalled();
    expect(workspaceDelete).not.toHaveBeenCalled();
    expect(problemUpdate).not.toHaveBeenCalled();
  });
});
