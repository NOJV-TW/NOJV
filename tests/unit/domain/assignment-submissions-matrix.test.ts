import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findDetailById,
  findStudents,
  groupByUserAndProblem,
  findAllOverrides,
  findScoringInputsByIds,
} = vi.hoisted(() => ({
  findDetailById: vi.fn(),
  findStudents: vi.fn(),
  groupByUserAndProblem: vi.fn(),
  findAllOverrides: vi.fn(() => Promise.resolve([])),
  // Live per-problem max = 100 per problem (matches the fixture points).
  findScoringInputsByIds: vi.fn((ids: string[]) =>
    Promise.resolve(
      ids.map((id) => ({
        id,
        type: "full_source",
        advancedConfig: null,
        testcaseSets: [{ weight: 100 }],
      })),
    ),
  ),
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: { findDetailById },
  courseMembershipRepo: { findStudents },
  submissionRepo: { groupByUserAndProblem },
  scoreOverrideRepo: { findAllByContext: findAllOverrides },
  problemRepo: { findScoringInputsByIds },
}));

import { courseDomain } from "@nojv/application";

const { buildSubmissionsMatrix } = courseDomain;

function fakeAssignment(closesAt: Date) {
  return {
    id: "asg_1",
    closesAt,
    problems: [
      {
        ordinal: 1,
        points: 100,
        problem: { id: "p1", title: "A" },
      },
    ],
  };
}

function fakeStudent(userId: string, name: string, username: string | null = null) {
  return {
    userId,
    user: { id: userId, name, username },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findAllOverrides.mockResolvedValue([]);
});

describe("buildSubmissionsMatrix", () => {
  it("surfaces post-close context-less practice attempts without changing official totals", async () => {
    const closesAt = new Date("2026-01-01T00:00:00.000Z");
    findDetailById.mockResolvedValue(fakeAssignment(closesAt));
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice", "alice")]);
    groupByUserAndProblem
      .mockResolvedValueOnce([
        { userId: "u1", problemId: "p1", _max: { score: 40 }, _count: { id: 1 } },
      ])
      .mockResolvedValueOnce([
        { userId: "u1", problemId: "p1", _max: { score: 100 }, _count: { id: 2 } },
      ]);

    const out = await buildSubmissionsMatrix("course_1", "asg_1", {
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(groupByUserAndProblem).toHaveBeenNthCalledWith(2, {
      assessmentId: null,
      contestId: null,
      courseId: null,
      createdAt: { gt: closesAt },
      examId: null,
      participationId: null,
      problemId: { in: ["p1"] },
      sampleOnly: false,
      userId: { in: ["u1"] },
    });

    expect(out.rows[0]?.cells[0]).toMatchObject({
      score: 40,
      attempts: 1,
      state: "partial",
      practiceScore: 100,
      practiceAttempts: 2,
    });
    expect(out.rows[0]?.total).toBe(40);
  });

  it("does not query practice submissions before the assignment closes", async () => {
    findDetailById.mockResolvedValue(fakeAssignment(new Date("2026-01-03T00:00:00.000Z")));
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice")]);
    groupByUserAndProblem.mockResolvedValueOnce([]);

    const out = await buildSubmissionsMatrix("course_1", "asg_1", {
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(groupByUserAndProblem).toHaveBeenCalledTimes(1);
    expect(out.rows[0]?.cells[0]).toMatchObject({
      score: null,
      attempts: 0,
      state: "empty",
      practiceScore: null,
      practiceAttempts: 0,
    });
  });

  it("keeps practice-only cells out of the official score", async () => {
    findDetailById.mockResolvedValue(fakeAssignment(new Date("2026-01-01T00:00:00.000Z")));
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice")]);
    groupByUserAndProblem
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { userId: "u1", problemId: "p1", _max: { score: 80 }, _count: { id: 1 } },
      ]);

    const out = await buildSubmissionsMatrix("course_1", "asg_1", {
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(out.rows[0]?.cells[0]).toMatchObject({
      score: null,
      attempts: 0,
      state: "empty",
      practiceScore: 80,
      practiceAttempts: 1,
    });
    expect(out.rows[0]?.total).toBe(0);
  });
});
