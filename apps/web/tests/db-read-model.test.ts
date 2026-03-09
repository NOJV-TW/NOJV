import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyProblems = vi.fn();
const findUniqueProblem = vi.fn();
const findManyCourses = vi.fn();
const findUniqueCourse = vi.fn();

vi.mock("@nojv/db", () => ({
  prisma: {
    course: {
      findMany: findManyCourses,
      findUnique: findUniqueCourse
    },
    problem: {
      findMany: findManyProblems,
      findUnique: findUniqueProblem
    }
  }
}));

describe("DB-backed read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyProblems.mockResolvedValue([]);
    findUniqueProblem.mockResolvedValue(null);
    findManyCourses.mockResolvedValue([]);
    findUniqueCourse.mockResolvedValue(null);
  });

  it("surfaces persisted public problems in the practice catalog", async () => {
    findManyProblems.mockResolvedValue([
      {
        defaultTitle: "Compiler Intro",
        difficulty: "easy",
        slug: "compiler-intro",
        submissions: [{ status: "accepted" }, { status: "wrong_answer" }],
        summary: "Introductory parser warmup.",
        visibility: "public"
      }
    ]);

    const { listProblemCards } = await import("../src/lib/server/read-model");
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

    const { getCoursePageData } = await import("../src/lib/server/read-model");
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
});
