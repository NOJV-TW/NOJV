import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Storage from "@nojv/storage";

const h = vi.hoisted(() => ({
  problem: {
    id: "p",
    authorId: "owner",
    visibility: "private",
    type: "full_source",
    judgeConfig: { type: "standard" },
    checkerStorage: null,
    interactorStorage: null,
  },
  revoked: false,
  revokeAtCommit: false,
  update: vi.fn(),
  lockStaff: vi.fn(),
  lockProblem: vi.fn(),
  upload: vi.fn(),
  deleteBlob: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@nojv/db", () => ({
  Prisma: { DbNull: null },
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    if (h.revokeAtCommit) h.revoked = true;
    return fn({});
  },
  userRepo: { findById: () => Promise.resolve({ canCreateAdvancedProblems: true }) },
  problemRepo: {
    findById: () => Promise.resolve(h.problem),
    withTx: () => ({ findById: () => Promise.resolve(h.problem), update: h.update }),
  },
  courseProblemRepo: {
    hasStaffAccess: () => Promise.resolve(!h.revoked),
    withTx: () => ({ lockStaffEditAccess: h.lockStaff, lockProblem: h.lockProblem }),
  },
  problemWorkspaceFileRepo: {
    withTx: () => ({
      findByProblemId: () => Promise.resolve([]),
      deleteByProblemId: h.replace,
    }),
  },
  testcaseSetRepo: {
    withTx: () => ({
      findByProblemId: () => Promise.resolve([]),
      deleteByProblemId: h.replace,
      countByProblem: () => Promise.resolve(0),
      maxOrdinalByProblem: () => Promise.resolve({ _max: { ordinal: null } }),
      create: () => Promise.resolve({ id: "set", name: "Set" }),
    }),
  },
  testcaseRepo: { withTx: () => ({ createMany: h.replace }) },
}));
vi.mock("@nojv/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof Storage>()),
  uploadProblemImage: h.upload,
  deleteBlob: h.deleteBlob,
  putImmutableText: vi.fn(),
}));
vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => ({}),
}));
vi.mock("../../../packages/application/src/shared/storage-object-lifecycle", () => ({
  commitStoragePointerSwap: vi.fn(),
  guardStorageObjectWrites: vi.fn(),
}));

import {
  createProblemTestcaseSetRecord,
  updateTestcaseSetRecord,
  deleteTestcaseSetRecord,
  updateTestcaseRecord,
  deleteTestcaseRecord,
} from "../../../packages/application/src/problem/testcase";
import {
  updateProblemWorkspace,
  setWorkspaceFile,
} from "../../../packages/application/src/problem/workspace";
import {
  saveProblemJudgeConfig,
  setProblemChecker,
  setProblemInteractor,
  updateAdvancedJudgeConfiguration,
  convertProblemToAdvancedMode,
  updateProblemRecord,
} from "../../../packages/application/src/problem/mutations";
import { importBundle, exportBundle } from "../../../packages/application/src/problem/bundle";
import { uploadProblemImage } from "../../../packages/application/src/problem/images";

const actor = { userId: "ta", username: "ta", platformRole: "student" as const };
const config = {
  run: {
    imageRef: `ghcr.io/nojv/run@sha256:${"a".repeat(64)}`,
    imageSource: "registry" as const,
  },
  grade: {
    imageRef: `ghcr.io/nojv/grade@sha256:${"b".repeat(64)}`,
    imageSource: "registry" as const,
  },
  network: { mode: "none" as const },
  maxScore: 100,
};
const emptyBundle = () => new JSZip().generateAsync({ type: "nodebuffer" });
beforeEach(() => {
  vi.clearAllMocks();
  h.revoked = false;
  h.revokeAtCommit = false;
  h.lockStaff.mockImplementation(() => Promise.resolve(!h.revoked));
  h.lockProblem.mockImplementation(() => Promise.resolve(h.problem));
  h.upload.mockResolvedValue("problems/p/images/fresh.png");
});

describe("content writes reauthorize at commit", () => {
  it.each([
    ["metadata", () => updateProblemRecord(actor, "p", { title: "Changed" })],
    [
      "create set",
      () =>
        createProblemTestcaseSetRecord(actor, "p", {
          name: "Set",
          description: "",
          weight: 1,
          cases: [{ input: "1", output: "2" }],
        }),
    ],
    ["update set", () => updateTestcaseSetRecord(actor, "p", "set", { weight: 2 })],
    ["delete set", () => deleteTestcaseSetRecord(actor, "p", "set")],
    ["update testcase", () => updateTestcaseRecord(actor, "p", "case", { input: "changed" })],
    ["delete testcase", () => deleteTestcaseRecord(actor, "p", "case")],
    ["workspace", () => updateProblemWorkspace(actor, "p", { files: [] })],
    [
      "workspace file",
      () =>
        setWorkspaceFile(actor, "p", {
          language: "python",
          path: "main.py",
          content: "print(1)",
          visibility: "editable",
        }),
    ],
    ["judge", () => saveProblemJudgeConfig(actor, "p", { judgeConfig: { type: "standard" } })],
    [
      "checker",
      () => setProblemChecker(actor, "p", { content: "int main(){}", language: "cpp" }),
    ],
    [
      "interactor",
      () => setProblemInteractor(actor, "p", { content: "int main(){}", language: "cpp" }),
    ],
    [
      "advanced configuration",
      () => updateAdvancedJudgeConfiguration(actor, "p", { config, requiredPaths: [] }),
    ],
    ["advanced conversion", () => convertProblemToAdvancedMode(actor, "p")],
    ["bundle", async () => importBundle(actor, "p", await emptyBundle())],
    ["image", () => uploadProblemImage(actor, "p", Buffer.from("image"), "image/png")],
  ] as const)("rejects revoked staff before %s writes", async (_name, write) => {
    h.revokeAtCommit = true;
    await expect(write()).rejects.toThrow(/not permitted to edit/i);
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.lockStaff.mock.invocationCallOrder[0]).toBeLessThan(
      h.lockProblem.mock.invocationCallOrder[0],
    );
  });

  it("lets authorized student TAs write testcases", async () => {
    await expect(
      createProblemTestcaseSetRecord(actor, "p", {
        name: "Set",
        description: "",
        weight: 1,
        cases: [{ input: "1", output: "2" }],
      }),
    ).resolves.toMatchObject({ id: "set", caseCount: 1 });
    expect(h.update).toHaveBeenCalledWith(
      "p",
      expect.objectContaining({ referenceSolutionSubmissionId: null }),
    );
  });

  it("imports content without replacing ownership, visibility or publication consent", async () => {
    await expect(importBundle(actor, "p", await emptyBundle())).resolves.toMatchObject({
      id: "p",
    });
    const update: unknown = h.update.mock.calls[0][1];
    for (const key of ["authorId", "visibility", "adminMayPublish", "courseLinks"])
      expect(update).not.toHaveProperty(key);
  });

  it("keeps bundle exports owner/admin only even for an authorized coeditor", async () => {
    await expect(exportBundle(actor, "p")).rejects.toThrow(/author or an admin/);
  });

  it("removes a newly uploaded image when permission was revoked during upload", async () => {
    h.upload.mockImplementation(() => {
      h.revoked = true;
      return Promise.resolve("problems/p/images/fresh.png");
    });
    await expect(
      uploadProblemImage(actor, "p", Buffer.from("image"), "image/png"),
    ).rejects.toThrow(/not permitted/i);
    expect(h.deleteBlob).toHaveBeenCalledWith(expect.anything(), "problems/p/images/fresh.png");
  });
});
