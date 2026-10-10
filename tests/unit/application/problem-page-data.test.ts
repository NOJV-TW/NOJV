import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Storage from "@nojv/storage";

const m = vi.hoisted(() => ({
  findDetailById: vi.fn(),
  findSummariesByProblemId: vi.fn(),
  findByProblemId: vi.fn(),
  countUserStatsByProblem: vi.fn(),
  getVerifiedText: vi.fn(),
}));

vi.mock("@nojv/storage", async (importOriginal) => {
  const original = await importOriginal<typeof Storage>();
  return { ...original, createStorageClient: () => ({}), getVerifiedText: m.getVerifiedText };
});

vi.mock("@nojv/db", () => ({
  problemRepo: { findDetailById: m.findDetailById },
  problemWorkspaceFileRepo: {},
  submissionRepo: { countUserStatsByProblem: m.countUserStatsByProblem },
  testcaseSetRepo: {
    findSummariesByProblemId: m.findSummariesByProblemId,
    findByProblemId: m.findByProblemId,
  },
}));

const { getProblemPageData, getProblemPageDataWithAccess, getProblemTestcaseSetSummaries } =
  await import("../../../packages/application/src/problem/details");

function persistedProblem(id: string, sha = "a") {
  return {
    id,
    authorId: "author-1",
    visibility: "private",
    author: { username: "author" },
    title: "Blanks",
    status: "published",
    difficulty: "easy",
    displayId: 7,
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    judgeConfig: null,
    advancedConfig: null,
    advancedRequiredPaths: [],
    testcaseSets: [{ weight: 40 }, { weight: 60 }],
    statement: null,
    tags: [],
    type: "multi_file",
    samples: [],
    workspaceFiles: [
      {
        language: "cpp",
        path: "main.cpp",
        contentStorage: {
          key: `problems/${id}/workspace/main`,
          sha256: sha.repeat(64),
          size: 12,
        },
        description: "",
        visibility: "editable",
      },
      {
        language: "cpp",
        path: "helper.h",
        contentStorage: {
          key: `problems/${id}/workspace/helper`,
          sha256: "c".repeat(64),
          size: 9,
        },
        description: "",
        visibility: "readonly",
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.countUserStatsByProblem.mockResolvedValue([{ attempters: 4, solvers: 1 }]);
  m.getVerifiedText.mockImplementation((_client: unknown, pointer: { sha256: string }) =>
    Promise.resolve(`int main${pointer.sha256[0]}`),
  );
});

describe("problem solving page data", () => {
  it("returns the access fields and page data from a single problem read", async () => {
    m.findDetailById.mockResolvedValue(persistedProblem("p-access"));

    const { access, problem } = await getProblemPageDataWithAccess("p-access");

    expect(m.findDetailById).toHaveBeenCalledTimes(1);
    expect(access).toEqual({ id: "p-access", authorId: "author-1", visibility: "private" });
    expect(problem).toMatchObject({
      id: "p-access",
      totalScore: 100,
      acceptanceRate: 0.25,
      totalSubmissions: 4,
      advancedConfig: null,
      starterByLanguage: expect.objectContaining({ cpp: "int maina" }),
    });
    expect(problem.workspaceFiles.map((file) => file.content)).toEqual([
      "int maina",
      "int mainc",
    ]);
    expect(await getProblemPageData("p-access")).toEqual(problem);
  });

  it("keeps the optional explanation on each sample", async () => {
    m.findDetailById.mockResolvedValue({
      ...persistedProblem("p-samples"),
      samples: [
        { input: "1 2", output: "3", explanation: "$1 + 2 = 3$" },
        { input: "0 0", output: "0" },
      ],
    });

    const problem = await getProblemPageData("p-samples");

    expect(problem.samples).toEqual([
      { input: "1 2", output: "3", explanation: "$1 + 2 = 3$" },
      { input: "0 0", output: "0" },
    ]);
  });

  it("reads each workspace file version from object storage once", async () => {
    m.findDetailById.mockResolvedValue(persistedProblem("p-cache"));
    await getProblemPageData("p-cache");
    await getProblemPageData("p-cache");
    expect(m.getVerifiedText).toHaveBeenCalledTimes(2);

    m.findDetailById.mockResolvedValue(persistedProblem("p-cache", "b"));
    const updated = await getProblemPageData("p-cache");
    expect(m.getVerifiedText).toHaveBeenCalledTimes(3);
    expect(updated.workspaceFiles[0]?.content).toBe("int mainb");
  });

  it("summarizes testcase sets from counts without loading testcase rows", async () => {
    m.findSummariesByProblemId.mockResolvedValue([
      {
        id: "set-1",
        name: "Subtask 1",
        description: "small",
        weight: 30,
        ordinal: 1,
        _count: { testcases: 12 },
      },
    ]);

    await expect(getProblemTestcaseSetSummaries("p")).resolves.toEqual([
      {
        id: "set-1",
        name: "Subtask 1",
        description: "small",
        weight: 30,
        ordinal: 1,
        caseCount: 12,
      },
    ]);
    expect(m.findSummariesByProblemId).toHaveBeenCalledWith("p");
    expect(m.findByProblemId).not.toHaveBeenCalled();
  });
});
