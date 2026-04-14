import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listWithCounts,
  findDetailById,
  countPublic,
  count: countProblems,
  groupAcceptedByProblem,
  countSubmissions,
  countCourses
} = vi.hoisted(() => ({
  listWithCounts: vi.fn(),
  findDetailById: vi.fn(),
  countPublic: vi.fn(),
  count: vi.fn(),
  groupAcceptedByProblem: vi.fn(),
  countSubmissions: vi.fn(),
  countCourses: vi.fn()
}));

vi.mock("$app/environment", () => ({
  browser: false,
  dev: true,
  building: false
}));

// Stub @nojv/storage so domain code can resolve `getText` without an S3
// backend. The fake `getText` returns the key it was called with so the
// content assertions below can use known values via `contentKey`.
vi.mock("@nojv/storage", () => {
  const blobStore = new Map<string, string>();
  return {
    createStorageClient: () => ({}),
    getText: vi.fn((_client: unknown, key: string) =>
      Promise.resolve(blobStore.get(key) ?? "")
    ),
    putText: vi.fn((_client: unknown, key: string, content: string) => {
      blobStore.set(key, content);
      return Promise.resolve();
    }),
    deleteBlob: vi.fn(() => Promise.resolve()),
    deleteBlobsByPrefix: vi.fn(() => Promise.resolve()),
    testcaseInputKey: (problemId: string, testcaseId: string) =>
      `problems/${problemId}/testcases/${testcaseId}/input`,
    testcaseOutputKey: (problemId: string, testcaseId: string) =>
      `problems/${problemId}/testcases/${testcaseId}/output`,
    testcaseInputFileKey: (problemId: string, testcaseId: string, filename: string) =>
      `problems/${problemId}/testcases/${testcaseId}/files/${filename}`,
    workspaceFileKey: (problemId: string, fileId: string) =>
      `problems/${problemId}/workspace/${fileId}`,
    problemPrefix: (problemId: string) => `problems/${problemId}/`,
    __blobStore: blobStore
  };
});

vi.mock("@nojv/db", () => ({
  problemRepo: {
    count: countProblems,
    countPublic,
    listWithCounts,
    findDetailById
  },
  problemStatementRepo: {
    fullTextSearch: vi.fn().mockResolvedValue([]),
    likeSearch: vi.fn().mockResolvedValue([])
  },
  submissionRepo: {
    count: countSubmissions,
    groupAcceptedByProblem,
    groupByProblemAndStatus: vi.fn().mockResolvedValue([])
  },
  courseRepo: {
    count: countCourses
  },
  announcementRepo: {
    listPublished: vi.fn().mockResolvedValue([])
  },
  assessmentRepo: {
    listByUser: vi.fn().mockResolvedValue([])
  },
  runTransaction: vi.fn()
}));

import { courseDomain, problemDomain } from "@nojv/domain";

const { listProblemCards, getProblemPageData } = problemDomain;
const { getDashboardStats } = courseDomain;

describe("DB-backed read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWithCounts.mockResolvedValue([]);
    findDetailById.mockResolvedValue(null);
    countProblems.mockResolvedValue(0);
    countPublic.mockResolvedValue(0);
    groupAcceptedByProblem.mockResolvedValue([]);
    countSubmissions.mockResolvedValue(0);
    countCourses.mockResolvedValue(0);
  });

  it("surfaces persisted public problems in the practice catalog", async () => {
    listWithCounts.mockResolvedValue([
      {
        _count: { submissions: 2, workspaceFiles: 0 },
        title: "Compiler Intro",
        id: "prob_compiler_intro",
        difficulty: "easy",
        tags: [],
        type: "full_source",
        visibility: "public"
      }
    ]);
    countProblems.mockResolvedValue(1);
    groupAcceptedByProblem.mockResolvedValue([{ _count: 1, problemId: "prob_compiler_intro" }]);

    const result = await listProblemCards();

    expect(result.problems).toContainEqual(
      expect.objectContaining({
        acceptanceRate: 0.5,
        difficulty: "easy",
        id: "prob_compiler_intro",
        title: "Compiler Intro",
        type: "full_source",
        totalSubmissions: 2
      })
    );
  });

  it("throws NotFoundError when a problem id is not found", async () => {
    findDetailById.mockResolvedValue(null);

    await expect(getProblemPageData("nonexistent-problem", "en")).rejects.toThrow(
      "Problem not found: nonexistent-problem"
    );
  });

  it("returns problem detail with samples from visible testcase set", async () => {
    findDetailById.mockResolvedValue({
      _count: { submissions: 10 },
      author: { username: "admin_user" },
      difficulty: "easy",
      title: "A+B Problem",
      id: "prob_ab",
      statements: [
        {
          bodyMarkdown: "Given two integers, compute their sum.",
          inputFormat: "Two integers a and b",
          locale: "en",
          outputFormat: "A single integer",
          title: "A+B Problem"
        }
      ],
      tags: ["easy", "math", "beginner"],
      type: "full_source",
      samples: [{ input: "1 2\n", output: "3\n" }],
      visibility: "public"
    });
    countSubmissions.mockResolvedValue(5);

    const detail = await getProblemPageData("prob_ab", "en");

    expect(detail).not.toBeNull();
    expect(detail?.title).toBe("A+B Problem");
    expect(detail?.authorUsername).toBe("admin_user");
    expect(detail?.inputFormat).toBe("Two integers a and b");
    expect(detail?.outputFormat).toBe("A single integer");
    expect(detail?.tags).toEqual(["easy", "math", "beginner"]);
    expect(detail?.difficulty).toBe("easy");
    expect(detail?.samples).toHaveLength(1);
    expect(detail?.samples[0]?.input).toBe("1 2\n");
    expect(detail?.samples[0]?.output).toBe("3\n");
    expect(detail?.starterByLanguage).toBeDefined();
    expect(detail?.starterByLanguage.python).toBeDefined();
    // Without workspace files, the field is an empty array.
    expect(detail?.workspaceFiles).toEqual([]);
  });

  it("exposes hidden workspace files as metadata-only (blank content) and uses editable ones for starter code", async () => {
    // Pre-populate the fake S3 store so the read path can `getText` the
    // workspace contents using the keys the rows point at.
    const storage = (await import("@nojv/storage")) as unknown as {
      __blobStore: Map<string, string>;
    };
    storage.__blobStore.set(
      "problems/prob_blanks/workspace/file_solution",
      "int solve() { return 42; }\n"
    );
    storage.__blobStore.set(
      "problems/prob_blanks/workspace/file_helpers",
      "#pragma once\nint solve();\n"
    );
    storage.__blobStore.set(
      "problems/prob_blanks/workspace/file_grader",
      "// server-only test harness\n"
    );

    findDetailById.mockResolvedValue({
      _count: { submissions: 0 },
      author: { username: "teacher" },
      title: "Fill in the Blanks",
      id: "prob_blanks",
      statements: [
        {
          bodyMarkdown: "Implement the missing function.",
          inputFormat: "",
          locale: "en",
          outputFormat: "",
          title: "Fill in the Blanks"
        }
      ],
      tags: ["easy"],
      type: "multi_file",
      samples: [],
      visibility: "public",
      workspaceFiles: [
        {
          language: "cpp",
          path: "solution.cpp",
          contentKey: "problems/prob_blanks/workspace/file_solution",
          description: "Your solution goes here.",
          visibility: "editable",
          orderIndex: 0
        },
        {
          language: "cpp",
          path: "helpers.h",
          contentKey: "problems/prob_blanks/workspace/file_helpers",
          description: "",
          visibility: "readonly",
          orderIndex: 1
        },
        {
          language: "cpp",
          path: "grader.cpp",
          contentKey: "problems/prob_blanks/workspace/file_grader",
          description: "Hidden server-side grader.",
          visibility: "hidden",
          orderIndex: 2
        }
      ]
    });
    countSubmissions.mockResolvedValue(0);

    const detail = await getProblemPageData("prob_blanks", "en");

    expect(detail).not.toBeNull();
    // All three files are exposed — hidden ones keep their metadata so the
    // UI can render them, but their raw content is blanked.
    expect(detail?.workspaceFiles).toHaveLength(3);
    expect(detail?.workspaceFiles.map((f) => f.path)).toEqual([
      "solution.cpp",
      "helpers.h",
      "grader.cpp"
    ]);
    // Hidden file's raw content must never leave the server.
    const hidden = detail?.workspaceFiles.find((f) => f.visibility === "hidden");
    expect(hidden?.content).toBe("");
    expect(hidden?.description).toBe("Hidden server-side grader.");
    // Non-hidden files keep their content and descriptions.
    expect(detail?.workspaceFiles[0]?.content).toBe("int solve() { return 42; }\n");
    expect(detail?.workspaceFiles[0]?.description).toBe("Your solution goes here.");
    expect(detail?.workspaceFiles[1]?.description).toBe("");
    // Starter code for cpp now reflects the editable workspace file.
    expect(detail?.starterByLanguage.cpp).toBe("int solve() { return 42; }\n");
    // Other languages still fall back to the hardcoded stub.
    expect(detail?.starterByLanguage.python).toBeDefined();
  });

  it("computes acceptance rate from total and accepted submissions", async () => {
    listWithCounts.mockResolvedValue([
      {
        _count: { submissions: 10, workspaceFiles: 0 },
        title: "Hard Problem",
        id: "prob_hard",
        tags: ["hard"],
        type: "full_source",
        visibility: "public"
      }
    ]);
    countProblems.mockResolvedValue(1);
    groupAcceptedByProblem.mockResolvedValue([{ _count: 3, problemId: "prob_hard" }]);

    const result = await listProblemCards();

    expect(result.problems[0]?.acceptanceRate).toBeCloseTo(0.3);
    expect(result.problems[0]?.totalSubmissions).toBe(10);
  });

  it("returns zero acceptance rate when there are no submissions", async () => {
    listWithCounts.mockResolvedValue([
      {
        _count: { submissions: 0, workspaceFiles: 0 },
        title: "New Problem",
        id: "prob_new",
        tags: ["medium"],
        type: "full_source",
        visibility: "public"
      }
    ]);
    countProblems.mockResolvedValue(1);

    const result = await listProblemCards();

    expect(result.problems[0]?.acceptanceRate).toBe(0);
  });

  it("returns dashboard stats from count queries", async () => {
    countPublic.mockResolvedValue(42);
    countCourses.mockResolvedValue(7);

    const stats = await getDashboardStats();

    expect(stats).toEqual({ courses: 7, problems: 42 });
  });
});
