import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listWithCounts,
  findDetailById,
  countPublic,
  count: countProblems,
  groupAcceptedByProblem,
  countSubmissions,
  findDetailBySlugCourse,
  countCourses
} = vi.hoisted(() => ({
  listWithCounts: vi.fn(),
  findDetailById: vi.fn(),
  countPublic: vi.fn(),
  count: vi.fn(),
  groupAcceptedByProblem: vi.fn(),
  countSubmissions: vi.fn(),
  findDetailBySlugCourse: vi.fn(),
  countCourses: vi.fn()
}));

vi.mock("$app/environment", () => ({
  browser: false,
  dev: true,
  building: false
}));

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
    count: countCourses,
    findDetailBySlug: findDetailBySlugCourse
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
const { getCoursePageData, getDashboardStats } = courseDomain;

describe("DB-backed read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWithCounts.mockResolvedValue([]);
    findDetailById.mockResolvedValue(null);
    countProblems.mockResolvedValue(0);
    countPublic.mockResolvedValue(0);
    groupAcceptedByProblem.mockResolvedValue([]);
    countSubmissions.mockResolvedValue(0);
    findDetailBySlugCourse.mockResolvedValue(null);
    countCourses.mockResolvedValue(0);
  });

  it("surfaces persisted public problems in the practice catalog", async () => {
    listWithCounts.mockResolvedValue([
      {
        _count: { submissions: 2, workspaceFiles: 0 },
        title: "Compiler Intro",
        id: "prob_compiler_intro",
        // Difficulty lives inside `tags` after the Phase 1 redesign.
        tags: ["easy"],
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

  it("returns persisted course detail data for dynamic course pages", async () => {
    findDetailBySlugCourse.mockResolvedValue({
      assessments: [
        {
          allowedLanguages: [],
          closesAt: new Date("2026-03-25T15:00:00.000Z"),
          dueAt: new Date("2026-03-23T15:00:00.000Z"),
          id: "assess_1",
          opensAt: new Date("2026-03-17T09:00:00.000Z"),
          problems: [
            {
              ordinal: 1,
              problem: {
                id: "prob_compiler_intro"
              }
            }
          ],
          slug: "hw1-parser",
          summary: "First compiler assignment.",
          title: "Homework 1"
        }
      ],
      description: "Compiler construction course.",
      joinTokens: [
        {
          kind: "code",
          label: "Course code",
          token: "COMPILER2026"
        }
      ],
      locale: "zh-TW",
      memberships: [
        {
          joinedTokenId: null,
          role: "teacher",
          user: {
            name: "Amelia Chen",
            email: "amelia@nojv.local",
            username: "teacher_amelia",
            platformRole: "teacher"
          },
          userId: "usr_teacher_amelia"
        }
      ],
      problems: [
        {
          problem: {
            author: {
              username: "teacher_amelia"
            },
            id: "prob_compiler_intro",
            statements: [
              {
                bodyMarkdown: "Write a recursive descent parser.",
                locale: "zh-TW",
                title: "Compiler Intro"
              }
            ],
            title: "Compiler Intro",
            visibility: "public"
          }
        }
      ],
      slug: "compiler-design-2026",
      title: "Compiler Design"
    });

    const detail = await getCoursePageData("compiler-design-2026");

    expect(detail?.course.title).toBe("Compiler Design");
    expect(detail?.course.assessments).toHaveLength(1);
    expect(detail?.course.assessments[0]).toEqual(
      expect.objectContaining({
        slug: "hw1-parser",
        summary: "First compiler assignment."
      })
    );
    expect(detail?.problems[0]).toEqual(
      expect.objectContaining({
        id: "prob_compiler_intro",
        title: "Compiler Intro"
      })
    );
  });

  it("returns null when a course slug is not found", async () => {
    findDetailBySlugCourse.mockResolvedValue(null);

    const detail = await getCoursePageData("nonexistent-course");

    expect(detail).toBeNull();
  });

  it("returns null when a problem id is not found", async () => {
    findDetailById.mockResolvedValue(null);

    const detail = await getProblemPageData("nonexistent-problem", "en");

    expect(detail).toBeNull();
  });

  it("returns problem detail with samples from visible testcase set", async () => {
    findDetailById.mockResolvedValue({
      _count: { submissions: 10 },
      author: { username: "admin_user" },
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
      samples: [{ stdin: "1 2\n", expected: "3\n" }],
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
    expect(detail?.samples[0]?.stdin).toBe("1 2\n");
    expect(detail?.samples[0]?.expected).toBe("3\n");
    expect(detail?.starterByLanguage).toBeDefined();
    expect(detail?.starterByLanguage.python).toBeDefined();
    // Without workspace files, the field is an empty array.
    expect(detail?.workspaceFiles).toEqual([]);
  });

  it("exposes hidden workspace files as metadata-only (blank content) and uses editable ones for starter code", async () => {
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
          content: "int solve() { return 42; }\n",
          description: "Your solution goes here.",
          visibility: "editable",
          editableRegions: [[1, 1]],
          orderIndex: 0
        },
        {
          language: "cpp",
          path: "helpers.h",
          content: "#pragma once\nint solve();\n",
          description: "",
          visibility: "readonly",
          editableRegions: null,
          orderIndex: 1
        },
        {
          language: "cpp",
          path: "grader.cpp",
          content: "// server-only test harness\n",
          description: "Hidden server-side grader.",
          visibility: "hidden",
          editableRegions: null,
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
    // Editable regions are parsed into tuples.
    expect(detail?.workspaceFiles[0]?.editableRegions).toEqual([[1, 1]]);
    expect(detail?.workspaceFiles[1]?.editableRegions).toBeNull();
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

  it("treats malformed editableRegions as null instead of crashing", async () => {
    findDetailById.mockResolvedValue({
      _count: { submissions: 0 },
      author: { username: "teacher" },
      title: "Malformed Regions",
      id: "prob_malformed",
      statements: [],
      tags: ["medium"],
      type: "full_source",
      samples: [],
      visibility: "public",
      workspaceFiles: [
        {
          language: "python",
          path: "main.py",
          content: "print('hello')\n",
          visibility: "editable",
          editableRegions: "not-an-array",
          orderIndex: 0
        }
      ]
    });
    countSubmissions.mockResolvedValue(0);

    const detail = await getProblemPageData("prob_malformed", "en");

    expect(detail?.workspaceFiles[0]?.editableRegions).toBeNull();
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
