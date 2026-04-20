import { beforeEach, describe, expect, it, vi } from "vitest";

const { examFindDetailById, findStudents, groupByUserAndProblem, findAllOverrides } =
  vi.hoisted(() => ({
    examFindDetailById: vi.fn(),
    findStudents: vi.fn(),
    groupByUserAndProblem: vi.fn(),
    findAllOverrides: vi.fn(() => Promise.resolve([])),
  }));

vi.mock("@nojv/db", () => ({
  examRepo: { findDetailById: examFindDetailById },
  courseMembershipRepo: { findStudents },
  submissionRepo: { groupByUserAndProblem },
  scoreOverrideRepo: { findAllByContext: findAllOverrides },
}));

import { examDomain, NotFoundError } from "@nojv/domain";

const { getExamSubmissionsMatrix } = examDomain;

function fakeExam(
  problems: { id: string; ordinal: number; points: number; title: string }[] = [],
) {
  return {
    id: "exam_1",
    courseId: "course_1",
    problems: problems.map((p) => ({
      ordinal: p.ordinal,
      points: p.points,
      problem: { id: p.id, title: p.title },
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

describe("getExamSubmissionsMatrix", () => {
  it("throws NotFoundError when the exam is missing", async () => {
    examFindDetailById.mockResolvedValue(null);
    await expect(getExamSubmissionsMatrix("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns an empty matrix when the course has no students", async () => {
    examFindDetailById.mockResolvedValue(
      fakeExam([{ id: "p1", ordinal: 1, points: 100, title: "A" }]),
    );
    findStudents.mockResolvedValue([]);

    const out = await getExamSubmissionsMatrix("exam_1");

    expect(out.rows).toEqual([]);
    expect(out.studentCount).toBe(0);
    expect(out.problems).toHaveLength(1);
    expect(out.totalPoints).toBe(100);
    expect(groupByUserAndProblem).not.toHaveBeenCalled();
  });

  it("returns an empty rows array when the exam has no problems", async () => {
    examFindDetailById.mockResolvedValue(fakeExam([]));
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice")]);

    const out = await getExamSubmissionsMatrix("exam_1");

    expect(out.rows).toEqual([]);
    expect(out.problems).toEqual([]);
    expect(out.totalPoints).toBe(0);
    expect(out.studentCount).toBe(1);
    expect(groupByUserAndProblem).not.toHaveBeenCalled();
  });

  it("derives cell state from best score against problem points", async () => {
    examFindDetailById.mockResolvedValue(
      fakeExam([
        { id: "p1", ordinal: 1, points: 100, title: "A" },
        { id: "p2", ordinal: 2, points: 100, title: "B" },
      ]),
    );
    findStudents.mockResolvedValue([
      fakeStudent("u1", "Alice", "alice"),
      fakeStudent("u2", "Bob", "bob"),
    ]);
    groupByUserAndProblem.mockResolvedValue([
      { userId: "u1", problemId: "p1", _max: { score: 100 }, _count: { id: 3 } },
      { userId: "u1", problemId: "p2", _max: { score: 40 }, _count: { id: 2 } },
      { userId: "u2", problemId: "p1", _max: { score: 0 }, _count: { id: 5 } },
    ]);

    const out = await getExamSubmissionsMatrix("exam_1");

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
    // zero-scored attempts are "zero"; no submission for p2 stays "empty".
    expect(bob.cells[0]).toMatchObject({ score: 0, attempts: 5, state: "zero" });
    expect(bob.cells[1]).toMatchObject({ score: null, attempts: 0, state: "empty" });
    expect(bob.total).toBe(0);
    expect(bob.handle).toBe("bob");
  });

  it("uses the correct ordinal→letter mapping", async () => {
    examFindDetailById.mockResolvedValue(
      fakeExam([
        { id: "p1", ordinal: 1, points: 100, title: "A" },
        { id: "p2", ordinal: 27, points: 100, title: "AA" },
      ]),
    );
    findStudents.mockResolvedValue([]);

    const out = await getExamSubmissionsMatrix("exam_1");
    expect(out.problems[0].letter).toBe("A");
    expect(out.problems[1].letter).toBe("AA");
  });

  it("falls back to an empty handle when the student has no username", async () => {
    examFindDetailById.mockResolvedValue(
      fakeExam([{ id: "p1", ordinal: 1, points: 100, title: "A" }]),
    );
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice", null)]);
    groupByUserAndProblem.mockResolvedValue([]);

    const out = await getExamSubmissionsMatrix("exam_1");
    expect(out.rows[0].handle).toBe("");
  });
});
