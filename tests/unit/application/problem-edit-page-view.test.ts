import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  assertRead: vi.fn(),
  canAdvanced: vi.fn(),
  canEdit: vi.fn(),
  canPublic: vi.fn(),
  pageData: vi.fn(),
  row: vi.fn(),
  sets: vi.fn(),
  files: vi.fn(),
  hydrateFiles: vi.fn(),
  hydrateScripts: vi.fn(),
  summarize: vi.fn(),
  verified: vi.fn(),
  reference: vi.fn(),
  credential: vi.fn(),
}));

vi.mock("../../../packages/application/src/problem/permissions", () => ({
  assertProblemContentReadAccess: m.assertRead,
  canCreateAdvancedProblems: m.canAdvanced,
  canProblemContentEdit: m.canEdit,
  canPublishPublicProblems: m.canPublic,
}));
vi.mock("../../../packages/application/src/problem/details", () => ({
  getProblemPageData: m.pageData,
  getProblemRowById: m.row,
  getProblemTestcaseSets: m.sets,
  listProblemWorkspaceFiles: m.files,
}));
vi.mock("../../../packages/application/src/problem/blobs", () => ({
  hydrateWorkspaceFiles: m.hydrateFiles,
  hydrateValidatorScripts: m.hydrateScripts,
  summarizeTestcaseSets: m.summarize,
}));
vi.mock("../../../packages/application/src/problem/mutations/publishing", () => ({
  hasVerifiedAdvancedJudgeRun: m.verified,
}));
vi.mock("../../../packages/application/src/submission/details", () => ({
  getProblemReferenceSolution: m.reference,
}));
vi.mock("../../../packages/application/src/registry/credentials", () => ({
  getRegistryCredentialStatus: m.credential,
}));

const { getProblemEditPageView } =
  await import("../../../packages/application/src/problem/edit-view");
const { NotFoundError } = await import("../../../packages/application/src/shared/errors");

const actor = {
  userId: "u1",
  username: "u1",
  displayName: "U1",
  email: "u1@example.com",
  platformRole: "teacher" as const,
};
const row = {
  id: "p1",
  authorId: "u1",
  visibility: "private",
  adminMayPublish: true,
  checkerStorage: "checker",
  interactorStorage: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  m.assertRead.mockResolvedValue(row);
  m.pageData.mockResolvedValue({
    type: "full_source",
    advancedConfig: null,
    advancedRequiredPaths: null,
    timeLimitMs: 1000,
    memoryLimitMb: 256,
  });
  m.row.mockResolvedValue(row);
  m.sets.mockResolvedValue([{ id: "raw-set" }]);
  m.files.mockResolvedValue([{ id: "raw-file" }]);
  m.hydrateFiles.mockResolvedValue([{ id: "file" }]);
  m.hydrateScripts.mockResolvedValue({ checker: "code" });
  m.summarize.mockReturnValue([{ id: "set" }]);
  m.canAdvanced.mockResolvedValue(false);
  m.canEdit.mockResolvedValue(true);
  m.canPublic.mockResolvedValue(true);
  m.reference.mockResolvedValue({ id: "ref" });
  m.credential.mockResolvedValue({
    username: "reg",
    createdAt: new Date(0),
    updatedAt: new Date(1),
    lastUsedAt: null,
  });
});

describe("getProblemEditPageView", () => {
  it("stops before any page read when content access is denied", async () => {
    m.assertRead.mockRejectedValue(new NotFoundError("Problem not found: p1"));
    await expect(getProblemEditPageView(actor, "p1")).rejects.toBeInstanceOf(NotFoundError);
    expect(m.pageData).not.toHaveBeenCalled();
    expect(m.row).not.toHaveBeenCalled();
  });

  it("assembles a standard problem with its reference solution", async () => {
    const view = await getProblemEditPageView(actor, "p1");

    expect(view).toMatchObject({
      adminMayPublish: true,
      testcaseSets: [{ id: "set" }],
      workspaceFiles: [{ id: "file" }],
      validatorScripts: { checker: "code" },
      advancedConfig: null,
      advancedJudgeVerified: false,
      referenceSolution: { id: "ref" },
      permissions: {
        canEdit: true,
        isAdmin: false,
        isOwner: true,
        publicVisibilityAllowed: true,
        canPublishPublicCopy: true,
        canPublishAsAdmin: false,
      },
      advancedCreationAllowed: false,
      registryCredential: null,
    });
    expect(m.hydrateScripts).toHaveBeenCalledWith({
      checkerStorage: "checker",
      interactorStorage: null,
    });
    expect(m.reference).toHaveBeenCalledWith(actor, "p1");
    expect(m.verified).not.toHaveBeenCalled();
    expect(m.credential).not.toHaveBeenCalled();
  });

  it("assembles an advanced problem with registry status and edit gating", async () => {
    m.pageData.mockResolvedValue({
      type: "special_env",
      advancedConfig: { image: "x" },
      advancedRequiredPaths: ["a"],
      timeLimitMs: 2000,
      memoryLimitMb: 512,
    });
    m.verified.mockResolvedValue(true);

    const view = await getProblemEditPageView(actor, "p1");

    expect(m.verified).toHaveBeenCalledWith("p1", { image: "x" }, ["a"], {
      totalTimeMs: 2000,
      memoryMb: 512,
    });
    expect(m.reference).not.toHaveBeenCalled();
    expect(view).toMatchObject({
      advancedConfig: { config: { image: "x" } },
      advancedJudgeVerified: true,
      referenceSolution: null,
      permissions: { canEdit: false },
      registryCredential: { username: "reg", updatedAt: new Date(1), lastUsedAt: null },
    });
    expect(view.registryCredential).not.toHaveProperty("createdAt");
  });
});
