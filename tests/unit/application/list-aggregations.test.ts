import { beforeEach, describe, expect, it, vi } from "vitest";
const { listActivities, groupByActivity, findCourseOverrides, countStudentsByCourse } =
  vi.hoisted(() => ({
    listActivities: vi.fn(),
    groupByActivity: vi.fn(),
    findCourseOverrides: vi.fn(),
    countStudentsByCourse: vi.fn(),
  }));
vi.mock("@nojv/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nojv/db")>()),
  gradingRepo: { listActivities },
  submissionRepo: { groupByActivity },
  scoreOverrideRepo: { findCourseOverrides },
  courseMembershipRepo: { countStudentsByCourse },
  problemRepo: {
    findScoringInputsByIds: async (ids: string[]) =>
      ids.map((id) => ({ id, type: "full_source", testcaseSets: [{ weight: 100 }] })),
  },
}));
import {
  aggregateAssignmentClassStats,
  aggregateAssignmentMyStatus,
  aggregateExamClassStats,
  aggregateExamMyStatus,
} from "@nojv/application";
beforeEach(() => {
  vi.clearAllMocks();
  listActivities.mockResolvedValue([
    {
      id: "a1",
      totalPoints: 100,
      problems: [
        { problemId: "p1", points: 40 },
        { problemId: "p2", points: 60 },
      ],
    },
  ]);
  groupByActivity.mockResolvedValue([
    { assessmentId: "a1", examId: "a1", userId: "u1", problemId: "p1", _max: { score: 80 } },
    { assessmentId: "a1", examId: "a1", userId: "u1", problemId: "p2", _max: { score: 50 } },
  ]);
  findCourseOverrides.mockResolvedValue([]);
  countStudentsByCourse.mockResolvedValue(new Map([["c1", 5]]));
});
describe("weighted activity list aggregates", () => {
  it("does not query for empty lists", async () => {
    expect((await aggregateAssignmentClassStats([])).size).toBe(0);
    expect((await aggregateExamMyStatus("u1", [])).size).toBe(0);
    expect(listActivities).not.toHaveBeenCalled();
  });
  it.each([aggregateAssignmentClassStats, aggregateExamClassStats])(
    "uses allocated scores in class averages",
    async (aggregate) => {
      expect(
        (await aggregate([{ id: "a1", courseId: "c1", problemCount: 2 }])).get("a1"),
      ).toEqual({ submittedUsers: 1, totalStudents: 5, avgScore: 62 });
      groupByActivity.mockResolvedValue([]);
      expect(
        (await aggregate([{ id: "a1", courseId: "c1", problemCount: 2 }])).get("a1")?.avgScore,
      ).toBe(0);
    },
  );
  it.each([aggregateAssignmentMyStatus, aggregateExamMyStatus])(
    "applies raw overrides once and keeps absent work unsolved",
    async (aggregate) => {
      findCourseOverrides.mockResolvedValue([
        {
          assessmentId: "a1",
          examId: "a1",
          membership: { userId: "u1" },
          courseMembershipId: "m1",
          problemId: "p1",
          overrideScore: 100,
        },
      ]);
      expect((await aggregate("u1", [{ id: "a1", problemCount: 2 }])).get("a1")).toEqual({
        solved: 1,
        total: 2,
        score: 70,
        totalPoints: 100,
      });
      groupByActivity.mockResolvedValue([]);
      findCourseOverrides.mockResolvedValue([]);
      expect((await aggregate("u1", [{ id: "a1", problemCount: 2 }])).get("a1")).toEqual({
        solved: 0,
        total: 2,
        score: 0,
        totalPoints: 100,
      });
    },
  );
  it("batches reads across activities", async () => {
    listActivities.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `a${i}`,
        totalPoints: 100,
        deadline: new Date("2026-09-24"),
        problems: [{ problemId: "p1", points: 100 }],
      })),
    );
    await aggregateAssignmentMyStatus(
      "u1",
      Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, problemCount: 1 })),
    );
    expect(findCourseOverrides).toHaveBeenCalledTimes(1);
    expect(groupByActivity).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["assignment", aggregateAssignmentMyStatus],
    ["exam", aggregateExamMyStatus],
  ] as const)(
    "keeps %s scores and overrides scoped to their activity",
    async (type, aggregate) => {
      const field = type === "exam" ? "examId" : "assessmentId";
      listActivities.mockResolvedValue(
        ["a1", "a2", "a3"].map((id) => ({
          id,
          totalPoints: 100,
          deadline: new Date("2026-09-24"),
          problems: [{ problemId: "p1", points: 100 }],
        })),
      );
      groupByActivity.mockResolvedValue([
        { [field]: "a1", userId: "u1", problemId: "p1", _max: { score: 40 } },
        { [field]: "a2", userId: "u1", problemId: "p1", _max: { score: 70 } },
      ]);
      findCourseOverrides.mockResolvedValue([
        {
          [field]: "a1",
          membership: { userId: "u1" },
          courseMembershipId: "m1",
          problemId: "p1",
          overrideScore: 90,
        },
      ]);
      const result = await aggregate(
        "u1",
        ["a1", "a2", "a3"].map((id) => ({ id, problemCount: 1 })),
      );
      expect([...result.values()].map((row) => row.score)).toEqual([90, 70, 0]);
      expect(findCourseOverrides).toHaveBeenCalledWith(type, ["a1", "a2", "a3"], "u1");
      expect(groupByActivity).toHaveBeenCalledTimes(1);
    },
  );
});
