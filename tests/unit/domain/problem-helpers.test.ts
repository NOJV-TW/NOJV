import { beforeEach, describe, expect, it, vi } from "vitest";

const { problemFindById, workspaceFindByProblemId } = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  workspaceFindByProblemId: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  problemRepo: {
    withTx: () => ({ findById: problemFindById }),
  },
  problemWorkspaceFileRepo: {
    findByProblemId: workspaceFindByProblemId,
  },
  // The other repos imported by problem/helpers.ts are not exercised here.
  assessmentProblemRepo: {},
  contestProblemRepo: {},
  examProblemRepo: {},
}));

import { problemDomain, NotFoundError, ValidationError } from "@nojv/domain";

const { assertProblemHasWorkspaceForLanguages } = problemDomain;

// The helper only reads from `tx` via `problemRepo.withTx(tx)`, which the
// mock above ignores. An empty object is enough to satisfy the parameter.
const tx = {} as Parameters<typeof assertProblemHasWorkspaceForLanguages>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertProblemHasWorkspaceForLanguages — full_source", () => {
  it("returns immediately without touching workspace files", async () => {
    problemFindById.mockResolvedValue({ id: "p1", type: "full_source" });

    await expect(
      assertProblemHasWorkspaceForLanguages(tx, "p1", ["python", "java", "cpp"]),
    ).resolves.toBeUndefined();

    expect(workspaceFindByProblemId).not.toHaveBeenCalled();
  });

  it("never throws for full_source even when residual workspace files mismatch", async () => {
    problemFindById.mockResolvedValue({ id: "p1", type: "full_source" });

    await expect(
      assertProblemHasWorkspaceForLanguages(tx, "p1", ["python"]),
    ).resolves.toBeUndefined();
    expect(workspaceFindByProblemId).not.toHaveBeenCalled();
  });
});

describe("assertProblemHasWorkspaceForLanguages — multi_file", () => {
  it("passes when every allowed language has an editable main.<ext>", async () => {
    problemFindById.mockResolvedValue({ id: "p2", type: "multi_file" });
    workspaceFindByProblemId.mockResolvedValue([
      { language: "python", path: "main.py", visibility: "editable" },
      { language: "java", path: "main.java", visibility: "editable" },
    ]);

    await expect(
      assertProblemHasWorkspaceForLanguages(tx, "p2", ["python", "java"]),
    ).resolves.toBeUndefined();
  });

  it("throws ValidationError when an allowed language has no editable main.<ext>", async () => {
    problemFindById.mockResolvedValue({ id: "p2", type: "multi_file" });
    workspaceFindByProblemId.mockResolvedValue([
      { language: "python", path: "main.py", visibility: "editable" },
    ]);

    await expect(
      assertProblemHasWorkspaceForLanguages(tx, "p2", ["python", "java"]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects when the matching file exists but is not editable (readonly/hidden)", async () => {
    problemFindById.mockResolvedValue({ id: "p2", type: "multi_file" });
    workspaceFindByProblemId.mockResolvedValue([
      { language: "python", path: "main.py", visibility: "readonly" },
    ]);

    await expect(
      assertProblemHasWorkspaceForLanguages(tx, "p2", ["python"]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("assertProblemHasWorkspaceForLanguages — common", () => {
  it("short-circuits when allowedLanguages is empty (no DB hit at all)", async () => {
    await expect(assertProblemHasWorkspaceForLanguages(tx, "p3", [])).resolves.toBeUndefined();
    expect(problemFindById).not.toHaveBeenCalled();
    expect(workspaceFindByProblemId).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the problem does not exist", async () => {
    problemFindById.mockResolvedValue(null);

    await expect(
      assertProblemHasWorkspaceForLanguages(tx, "missing", ["python"]),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(workspaceFindByProblemId).not.toHaveBeenCalled();
  });

  it("does not enforce workspace for special_env (advanced) problems", async () => {
    problemFindById.mockResolvedValue({ id: "p4", type: "special_env" });

    await expect(
      assertProblemHasWorkspaceForLanguages(tx, "p4", ["python"]),
    ).resolves.toBeUndefined();
    expect(workspaceFindByProblemId).not.toHaveBeenCalled();
  });
});
