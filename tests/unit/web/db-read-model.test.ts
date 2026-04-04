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

import { listProblemCards, getProblemPageData } from "$lib/server/problem/queries";
import { courseDomain } from "@nojv/domain";

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
        _count: { submissions: 2 },
        defaultTitle: "Compiler Intro",
        difficulty: "easy",
        id: "prob_compiler_intro",
        summary: "Introductory parser warmup.",
        tags: [],
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
          ipBindingEnabled: false,
          ipViolationMode: "notify",
          ipWhitelist: [],
          ipWhitelistEnabled: false,
          opensAt: new Date("2026-03-17T09:00:00.000Z"),
          pageLockEnabled: false,
          problems: [
            {
              ordinal: 1,
              problem: {
                id: "prob_compiler_intro"
              }
            }
          ],
          scoreboardMode: "hidden",
          slug: "hw1-parser",
          summary: "First compiler assignment.",
          title: "Homework 1",
          type: "assignment"
        }
      ],
      description: "Compiler construction course.",
      joinTokens: [
        {
          label: "Course code",
          method: "join_code",
          token: "COMPILER2026"
        }
      ],
      locale: "zh-TW",
      memberships: [
        {
          joinedVia: "manual_invite",
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
            summary: "Introductory parser warmup.",
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
      defaultTitle: "A+B Problem",
      difficulty: "easy",
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
      summary: "Basic addition problem.",
      tags: ["math", "beginner"],
      templates: [],
      testcaseSets: [
        {
          isHidden: false,
          testcases: [{ expectedStdout: "3\n", stdin: "1 2\n" }]
        },
        {
          isHidden: true,
          testcases: [{ expectedStdout: "200\n", stdin: "100 100\n" }]
        }
      ],
      visibility: "public"
    });
    countSubmissions.mockResolvedValue(5);

    const detail = await getProblemPageData("prob_ab", "en");

    expect(detail).not.toBeNull();
    expect(detail?.title).toBe("A+B Problem");
    expect(detail?.authorUsername).toBe("admin_user");
    expect(detail?.inputFormat).toBe("Two integers a and b");
    expect(detail?.outputFormat).toBe("A single integer");
    expect(detail?.tags).toEqual(["math", "beginner"]);
    expect(detail?.samples).toHaveLength(1);
    expect(detail?.samples[0]?.input).toBe("1 2\n");
    expect(detail?.samples[0]?.output).toBe("3\n");
    expect(detail?.starterByLanguage).toBeDefined();
    expect(detail?.starterByLanguage.python).toBeDefined();
  });

  it("computes acceptance rate from total and accepted submissions", async () => {
    listWithCounts.mockResolvedValue([
      {
        _count: { submissions: 10 },
        defaultTitle: "Hard Problem",
        difficulty: "hard",
        id: "prob_hard",
        summary: "A hard problem.",
        tags: [],
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
        _count: { submissions: 0 },
        defaultTitle: "New Problem",
        difficulty: "medium",
        id: "prob_new",
        summary: "A new problem.",
        tags: [],
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
