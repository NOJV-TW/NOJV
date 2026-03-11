import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findManyProblems,
  findUniqueProblem,
  countProblems,
  findManyCourses,
  findUniqueCourse,
  countCourses,
  groupBySubmissions,
  countSubmissions,
  findManyAssessments,
  findManyAnnouncements
} = vi.hoisted(() => ({
  findManyProblems: vi.fn(),
  findUniqueProblem: vi.fn(),
  countProblems: vi.fn(),
  findManyCourses: vi.fn(),
  findUniqueCourse: vi.fn(),
  countCourses: vi.fn(),
  groupBySubmissions: vi.fn(),
  countSubmissions: vi.fn(),
  findManyAssessments: vi.fn(),
  findManyAnnouncements: vi.fn()
}));

vi.mock("$app/environment", () => ({
  browser: false,
  dev: true,
  building: false
}));

vi.mock("@nojv/db", () => ({
  prisma: {
    announcement: {
      findMany: findManyAnnouncements
    },
    course: {
      count: countCourses,
      findMany: findManyCourses,
      findUnique: findUniqueCourse
    },
    courseAssessment: {
      findMany: findManyAssessments
    },
    problem: {
      count: countProblems,
      findMany: findManyProblems,
      findUnique: findUniqueProblem
    },
    submission: {
      count: countSubmissions,
      groupBy: groupBySubmissions
    }
  }
}));

import { listProblemCards, getProblemPageData } from "$lib/server/problem/queries";
import { getCoursePageData, getDashboardStats } from "$lib/server/course/queries";

describe("DB-backed read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyProblems.mockResolvedValue([]);
    findUniqueProblem.mockResolvedValue(null);
    countProblems.mockResolvedValue(0);
    findManyCourses.mockResolvedValue([]);
    findUniqueCourse.mockResolvedValue(null);
    countCourses.mockResolvedValue(0);
    groupBySubmissions.mockResolvedValue([]);
    countSubmissions.mockResolvedValue(0);
    findManyAssessments.mockResolvedValue([]);
    findManyAnnouncements.mockResolvedValue([]);
  });

  it("surfaces persisted public problems in the practice catalog", async () => {
    findManyProblems.mockResolvedValue([
      {
        _count: { submissions: 2 },
        defaultTitle: "Compiler Intro",
        difficulty: "easy",
        id: "prob_compiler_intro",
        slug: "compiler-intro",
        summary: "Introductory parser warmup.",
        visibility: "public"
      }
    ]);
    groupBySubmissions.mockResolvedValue([{ _count: 1, problemId: "prob_compiler_intro" }]);

    const cards = await listProblemCards();

    expect(cards).toContainEqual(
      expect.objectContaining({
        acceptanceRate: 0.5,
        difficulty: "easy",
        slug: "compiler-intro",
        title: "Compiler Intro",
        totalSubmissions: 2
      })
    );
  });

  it("returns persisted course detail data for dynamic course pages", async () => {
    findUniqueCourse.mockResolvedValue({
      assessments: [
        {
          closesAt: new Date("2026-03-25T15:00:00.000Z"),
          dueAt: new Date("2026-03-23T15:00:00.000Z"),
          opensAt: new Date("2026-03-17T09:00:00.000Z"),
          problemLinks: [
            {
              ordinal: 1,
              problem: {
                author: {
                  handle: "teacher_amelia"
                },
                slug: "compiler-intro",
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
            handle: "teacher_amelia",
            platformRole: "teacher"
          },
          userId: "usr_teacher_amelia"
        }
      ],
      problems: [
        {
          problem: {
            author: {
              handle: "teacher_amelia"
            },
            slug: "compiler-intro",
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
        slug: "compiler-intro",
        title: "Compiler Intro"
      })
    );
  });

  it("returns null when a course slug is not found", async () => {
    findUniqueCourse.mockResolvedValue(null);

    const detail = await getCoursePageData("nonexistent-course");

    expect(detail).toBeNull();
  });

  it("returns null when a problem slug is not found", async () => {
    findUniqueProblem.mockResolvedValue(null);

    const detail = await getProblemPageData("nonexistent-problem", "en");

    expect(detail).toBeNull();
  });

  it("returns problem detail with samples from visible testcase set", async () => {
    findUniqueProblem.mockResolvedValue({
      _count: { submissions: 10 },
      author: { handle: "admin_user" },
      defaultTitle: "A+B Problem",
      difficulty: "easy",
      id: "prob_ab",
      slug: "a-plus-b",
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
      testcaseSets: [
        {
          isHidden: false,
          testcases: [
            { expectedStdout: "3\n", stdin: "1 2\n" }
          ]
        },
        {
          isHidden: true,
          testcases: [
            { expectedStdout: "200\n", stdin: "100 100\n" }
          ]
        }
      ],
      visibility: "public"
    });
    countSubmissions.mockResolvedValue(5);

    const detail = await getProblemPageData("a-plus-b", "en");

    expect(detail).not.toBeNull();
    expect(detail?.title).toBe("A+B Problem");
    expect(detail?.authorHandle).toBe("admin_user");
    expect(detail?.inputFormat).toBe("Two integers a and b");
    expect(detail?.outputFormat).toBe("A single integer");
    expect(detail?.tags).toEqual(["math", "beginner"]);
    expect(detail?.samples).toHaveLength(1);
    expect(detail?.samples[0]?.input).toBe("1 2\n");
    expect(detail?.samples[0]?.output).toBe("3\n");
    expect(detail?.starterByLanguage).toBeDefined();
    expect(detail?.starterByLanguage.python).toContain("print");
  });

  it("computes acceptance rate from total and accepted submissions", async () => {
    findManyProblems.mockResolvedValue([
      {
        _count: { submissions: 10 },
        defaultTitle: "Hard Problem",
        difficulty: "hard",
        id: "prob_hard",
        slug: "hard-problem",
        summary: "A hard problem.",
        tags: [],
        visibility: "public"
      }
    ]);
    groupBySubmissions.mockResolvedValue([{ _count: 3, problemId: "prob_hard" }]);

    const cards = await listProblemCards();

    expect(cards[0]?.acceptanceRate).toBeCloseTo(0.3);
    expect(cards[0]?.totalSubmissions).toBe(10);
  });

  it("returns zero acceptance rate when there are no submissions", async () => {
    findManyProblems.mockResolvedValue([
      {
        _count: { submissions: 0 },
        defaultTitle: "New Problem",
        difficulty: "medium",
        id: "prob_new",
        slug: "new-problem",
        summary: "A new problem.",
        tags: [],
        visibility: "public"
      }
    ]);

    const cards = await listProblemCards();

    expect(cards[0]?.acceptanceRate).toBe(0);
  });

  it("returns dashboard stats from count queries", async () => {
    countProblems.mockResolvedValue(42);
    countCourses.mockResolvedValue(7);

    const stats = await getDashboardStats();

    expect(stats).toEqual({ courses: 7, problems: 42 });
  });
});
