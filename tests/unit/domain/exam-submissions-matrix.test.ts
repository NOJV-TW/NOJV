import { beforeEach, describe, expect, it, vi } from "vitest";

const { findStudents, groupByUserAndProblem, findAllOverrides, findScoringInputsByIds } =
  vi.hoisted(() => ({
    findStudents: vi.fn(),
    groupByUserAndProblem: vi.fn(),
    findAllOverrides: vi.fn(() => Promise.resolve([])),
    // Live per-problem max = 100 per problem (matches the input points below).
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
  courseMembershipRepo: { findStudents },
  submissionRepo: { groupByUserAndProblem },
  scoreOverrideRepo: { findAllByContext: findAllOverrides },
  problemRepo: { findScoringInputsByIds },
}));

import { examDomain } from "@nojv/application";

const { buildExamSubmissionsMatrix } = examDomain;

function buildInput(
  problems: { id: string; ordinal: number; points: number; title: string }[] = [],
) {
  return {
    examId: "exam_1",
    courseId: "course_1",
    problems: problems.map((p) => ({
      problemId: p.id,
      ordinal: p.ordinal,
      points: p.points,
      title: p.title,
    })),
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
});

describe("buildExamSubmissionsMatrix", () => {
  it("returns an empty matrix when the course has no students", async () => {
    findStudents.mockResolvedValue([]);

    const out = await buildExamSubmissionsMatrix(
      buildInput([{ id: "p1", ordinal: 1, points: 100, title: "A" }]),
    );

    expect(out.rows).toEqual([]);
    expect(out.studentCount).toBe(0);
    expect(out.problems).toHaveLength(1);
    expect(out.totalPoints).toBe(100);
    expect(groupByUserAndProblem).not.toHaveBeenCalled();
  });

  it("returns an empty rows array when the exam has no problems", async () => {
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice")]);

    const out = await buildExamSubmissionsMatrix(buildInput([]));

    expect(out.rows).toEqual([]);
    expect(out.problems).toEqual([]);
    expect(out.totalPoints).toBe(0);
    expect(out.studentCount).toBe(1);
    expect(groupByUserAndProblem).not.toHaveBeenCalled();
  });

  it("derives cell state from best score against problem points", async () => {
    findStudents.mockResolvedValue([
      fakeStudent("u1", "Alice", "alice"),
      fakeStudent("u2", "Bob", "bob"),
    ]);
    groupByUserAndProblem.mockResolvedValue([
      { userId: "u1", problemId: "p1", _max: { score: 100 }, _count: { id: 3 } },
      { userId: "u1", problemId: "p2", _max: { score: 40 }, _count: { id: 2 } },
      { userId: "u2", problemId: "p1", _max: { score: 0 }, _count: { id: 5 } },
    ]);

    const out = await buildExamSubmissionsMatrix(
      buildInput([
        { id: "p1", ordinal: 1, points: 100, title: "A" },
        { id: "p2", ordinal: 2, points: 100, title: "B" },
      ]),
    );

    expect(out.studentCount).toBe(2);
    expect(out.totalPoints).toBe(200);

    const alice = out.rows.find((r) => r.userId === "u1")!;
    expect(alice.cells[0]).toMatchObject({
      problemId: "p1",
      score: 100,
      attempts: 3,
      state: "ac",
    });
    expect(alice.cells[1]).toMatchObject({
      problemId: "p2",
      score: 40,
      attempts: 2,
      state: "partial",
    });
    expect(alice.total).toBe(140);
    expect(alice.handle).toBe("alice");

    const bob = out.rows.find((r) => r.userId === "u2")!;
    expect(bob.cells[0]).toMatchObject({ score: 0, attempts: 5, state: "zero" });
    expect(bob.cells[1]).toMatchObject({ score: null, attempts: 0, state: "empty" });
    expect(bob.total).toBe(0);
    expect(bob.handle).toBe("bob");
  });

  it("uses the correct ordinal→letter mapping", async () => {
    findStudents.mockResolvedValue([]);

    const out = await buildExamSubmissionsMatrix(
      buildInput([
        { id: "p1", ordinal: 1, points: 100, title: "A" },
        { id: "p2", ordinal: 27, points: 100, title: "AA" },
      ]),
    );
    expect(out.problems[0].letter).toBe("A");
    expect(out.problems[1].letter).toBe("AA");
  });

  it("falls back to an empty handle when the student has no username", async () => {
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice", null)]);
    groupByUserAndProblem.mockResolvedValue([]);

    const out = await buildExamSubmissionsMatrix(
      buildInput([{ id: "p1", ordinal: 1, points: 100, title: "A" }]),
    );
    expect(out.rows[0].handle).toBe("");
  });
});
