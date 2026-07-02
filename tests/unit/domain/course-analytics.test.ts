import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listPublishedWithProblemsByCourse,
  findStudents,
  groupBestScoresByAssessment,
  groupStatusByAssessments,
  countUserStatsByProblemForAssessments,
  findScoringInputsByIds,
} = vi.hoisted(() => ({
  listPublishedWithProblemsByCourse: vi.fn(),
  findStudents: vi.fn(),
  groupBestScoresByAssessment: vi.fn(),
  groupStatusByAssessments: vi.fn(),
  countUserStatsByProblemForAssessments: vi.fn(),
  findScoringInputsByIds: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: { listPublishedWithProblemsByCourse },
  courseMembershipRepo: { findStudents },
  submissionRepo: {
    groupBestScoresByAssessment,
    groupStatusByAssessments,
    countUserStatsByProblemForAssessments,
  },
  problemRepo: { findScoringInputsByIds },
}));

import { courseDomain } from "@nojv/application";

const { getCourseAnalytics } = courseDomain;

function student(userId: string, name: string, username: string | null) {
  return { userId, user: { name, username } };
}

beforeEach(() => {
  listPublishedWithProblemsByCourse.mockReset();
  findStudents.mockReset();
  groupBestScoresByAssessment.mockReset();
  groupStatusByAssessments.mockReset();
  countUserStatsByProblemForAssessments.mockReset();
  // Live per-problem max = 100 per problem (matches the fixture points).
  findScoringInputsByIds.mockReset().mockImplementation((ids: string[]) =>
    Promise.resolve(
      ids.map((id) => ({
        id,
        type: "full_source",
        advancedConfig: null,
        testcaseSets: [{ weight: 100 }],
      })),
    ),
  );
});

describe("getCourseAnalytics", () => {
  it("flags all students as no-submission when the course has no assignments", async () => {
    listPublishedWithProblemsByCourse.mockResolvedValue([]);
    findStudents.mockResolvedValue([
      student("u1", "Alice", "alice"),
      student("u2", "Bob", "bob"),
    ]);

    const result = await getCourseAnalytics("c1");

    expect(result.assessmentCount).toBe(0);
    expect(result.assessmentSummaries).toEqual([]);
    expect(result.hardestProblems).toEqual([]);
    expect(result.verdictDistribution).toEqual([]);
    expect(result.studentsAtRisk).toEqual([
      { userId: "u1", name: "Alice", username: "alice", reason: "no_submissions" },
      { userId: "u2", name: "Bob", username: "bob", reason: "no_submissions" },
    ]);
    expect(groupBestScoresByAssessment).not.toHaveBeenCalled();
  });

  it("computes per-assessment completion, hardest problems, at-risk students, and verdicts", async () => {
    listPublishedWithProblemsByCourse.mockResolvedValue([
      {
        id: "a1",
        title: "Week 1",
        problems: [
          { points: 100, problem: { id: "p1", displayId: 1, title: "Sum" } },
          { points: 100, problem: { id: "p2", displayId: 2, title: "Sort" } },
        ],
      },
    ]);
    findStudents.mockResolvedValue([
      student("u1", "Alice", "alice"), // both full -> completed
      student("u2", "Bob", "bob"), // partial -> not completed, submitter
      student("u3", "Carol", "carol"), // submitted but all zero -> at risk
      student("u4", "Dave", "dave"), // never submitted -> at risk
    ]);
    groupBestScoresByAssessment.mockResolvedValue([
      { assessmentId: "a1", userId: "u1", problemId: "p1", _max: { score: 100 } },
      { assessmentId: "a1", userId: "u1", problemId: "p2", _max: { score: 100 } },
      { assessmentId: "a1", userId: "u2", problemId: "p1", _max: { score: 100 } },
      { assessmentId: "a1", userId: "u2", problemId: "p2", _max: { score: 40 } },
      { assessmentId: "a1", userId: "u3", problemId: "p1", _max: { score: 0 } },
    ]);
    groupStatusByAssessments.mockResolvedValue([
      { status: "accepted", _count: { _all: 5 } },
      { status: "wrong_answer", _count: { _all: 9 } },
    ]);
    countUserStatsByProblemForAssessments.mockResolvedValue([
      { problemId: "p1", attempters: 3, solvers: 2 }, // 67%
      { problemId: "p2", attempters: 2, solvers: 1 }, // 50% -> hardest
    ]);

    const result = await getCourseAnalytics("c1");

    expect(result.assessmentCount).toBe(1);
    expect(result.studentCount).toBe(4);

    const summary = result.assessmentSummaries[0];
    expect(summary.assessmentId).toBe("a1");
    expect(summary.problemCount).toBe(2);
    expect(summary.avgScore).toBe(113);
    expect(summary.completionRate).toBeCloseTo(0.25);

    expect(result.hardestProblems.map((p) => p.problemId)).toEqual(["p2", "p1"]);
    expect(result.hardestProblems[0].acRate).toBeCloseTo(0.5);

    expect(result.verdictDistribution).toEqual([
      { status: "wrong_answer", count: 9 },
      { status: "accepted", count: 5 },
    ]);

    expect(result.studentsAtRisk).toEqual([
      { userId: "u3", name: "Carol", username: "carol", reason: "all_zero" },
      { userId: "u4", name: "Dave", username: "dave", reason: "no_submissions" },
    ]);
  });
});
