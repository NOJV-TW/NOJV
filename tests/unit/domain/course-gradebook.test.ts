import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findStudents,
  listAssessments,
  listExams,
  groupByUserAndProblem,
  findAllOverrides,
  findScoringInputsByIds,
} = vi.hoisted(() => ({
  findStudents: vi.fn(),
  listAssessments: vi.fn(() => Promise.resolve([])),
  listExams: vi.fn(() => Promise.resolve([])),
  groupByUserAndProblem: vi.fn(() => Promise.resolve([])),
  findAllOverrides: vi.fn(() => Promise.resolve([])),
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
  assessmentRepo: { listPublishedWithProblemsByCourse: listAssessments },
  examRepo: { listPublishedWithProblemsByCourse: listExams },
  submissionRepo: { groupByUserAndProblem },
  scoreOverrideRepo: { findAllByContext: findAllOverrides },
  problemRepo: { findScoringInputsByIds },
}));

import { courseDomain } from "@nojv/application";

const { buildCourseGradebook } = courseDomain;

function fakeStudent(userId: string, name: string, username: string | null = null) {
  return { userId, user: { id: userId, name, username } };
}

function fakeAssessment(id: string, title: string, opensAt: Date, problemIds: string[]) {
  return {
    id,
    title,
    opensAt,
    problems: problemIds.map((pid) => ({
      points: 100,
      problem: { id: pid, displayId: null, title: `Problem ${pid}` },
    })),
  };
}

function fakeExam(id: string, title: string, startsAt: Date, problemIds: string[]) {
  return {
    id,
    title,
    startsAt,
    problems: problemIds.map((pid) => ({
      points: 100,
      problem: { id: pid, displayId: null, title: `Problem ${pid}` },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildCourseGradebook", () => {
  it("returns empty columns and student rows with zero totals when the course has no contexts", async () => {
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice")]);

    const out = await buildCourseGradebook("course_1");

    expect(out.columns).toEqual([]);
    expect(out.maxTotal).toBe(0);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ userId: "u1", name: "Alice", total: 0 });
    expect(groupByUserAndProblem).not.toHaveBeenCalled();
  });

  it("merges assignments and exams into chronological columns with per-problem max scores", async () => {
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice", "alice")]);
    listAssessments.mockResolvedValue([
      fakeAssessment("a1", "HW 1", new Date("2026-03-01"), ["p1", "p2"]),
    ]);
    listExams.mockResolvedValue([fakeExam("e1", "Midterm", new Date("2026-02-01"), ["p3"])]);

    const out = await buildCourseGradebook("course_1");

    expect(out.columns.map((c) => c.contextId)).toEqual(["e1", "a1"]);
    expect(out.columns[0]).toMatchObject({
      contextType: "exam",
      contextTitle: "Midterm",
      maxTotal: 100,
    });
    expect(out.columns[1]).toMatchObject({
      contextType: "assignment",
      contextTitle: "HW 1",
      maxTotal: 200,
    });
    expect(out.columns[1].problems).toEqual([
      { problemId: "p1", ordinal: 1, title: "Problem p1", maxScore: 100 },
      { problemId: "p2", ordinal: 2, title: "Problem p2", maxScore: 100 },
    ]);
    expect(out.maxTotal).toBe(300);
  });

  it("fills cells from best scores, applies overrides, and totals raw points", async () => {
    findStudents.mockResolvedValue([
      fakeStudent("u1", "Alice", "alice"),
      fakeStudent("u2", "Bob", "bob"),
    ]);
    listAssessments.mockResolvedValue([
      fakeAssessment("a1", "HW 1", new Date("2026-03-01"), ["p1", "p2"]),
    ]);
    listExams.mockResolvedValue([fakeExam("e1", "Midterm", new Date("2026-04-01"), ["p3"])]);
    groupByUserAndProblem.mockImplementation((where: { assessmentId?: string }) =>
      Promise.resolve(
        where.assessmentId === "a1"
          ? [
              { userId: "u1", problemId: "p1", _max: { score: 100 }, _count: { id: 2 } },
              { userId: "u1", problemId: "p2", _max: { score: 40 }, _count: { id: 1 } },
              { userId: "u2", problemId: "p1", _max: { score: 0 }, _count: { id: 3 } },
            ]
          : [{ userId: "u1", problemId: "p3", _max: { score: 70 }, _count: { id: 1 } }],
      ),
    );
    findAllOverrides.mockImplementation((contextType: string) =>
      Promise.resolve(
        contextType === "exam"
          ? [{ userId: "u2", problemId: "p3", overrideScore: 55 }]
          : [],
      ),
    );

    const out = await buildCourseGradebook("course_1");

    const alice = out.rows.find((r) => r.userId === "u1")!;
    expect(alice.cells["assignment:a1:p1"]).toBe(100);
    expect(alice.cells["assignment:a1:p2"]).toBe(40);
    expect(alice.cells["exam:e1:p3"]).toBe(70);
    expect(alice.total).toBe(210);

    const bob = out.rows.find((r) => r.userId === "u2")!;
    expect(bob.cells["assignment:a1:p1"]).toBe(0);
    expect(bob.cells["assignment:a1:p2"]).toBeNull();
    expect(bob.cells["exam:e1:p3"]).toBe(55);
    expect(bob.total).toBe(55);
  });

  it("scopes submission queries per context", async () => {
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice")]);
    listAssessments.mockResolvedValue([
      fakeAssessment("a1", "HW 1", new Date("2026-03-01"), ["p1"]),
    ]);
    listExams.mockResolvedValue([fakeExam("e1", "Midterm", new Date("2026-04-01"), ["p3"])]);

    await buildCourseGradebook("course_1");

    expect(groupByUserAndProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "a1",
        userId: { in: ["u1"] },
        problemId: { in: ["p1"] },
        sampleOnly: false,
      }),
    );
    expect(groupByUserAndProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        examId: "e1",
        userId: { in: ["u1"] },
        problemId: { in: ["p3"] },
        sampleOnly: false,
      }),
    );
  });

  it("returns only the requested student's row when forUserId is set", async () => {
    findStudents.mockResolvedValue([
      fakeStudent("u1", "Alice", "alice"),
      fakeStudent("u2", "Bob", "bob"),
    ]);
    listAssessments.mockResolvedValue([
      fakeAssessment("a1", "HW 1", new Date("2026-03-01"), ["p1"]),
    ]);

    const out = await buildCourseGradebook("course_1", { forUserId: "u2" });

    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].userId).toBe("u2");
    expect(groupByUserAndProblem).toHaveBeenCalledWith(
      expect.objectContaining({ userId: { in: ["u2"] } }),
    );
  });

  it("returns no rows when forUserId is not an active student", async () => {
    findStudents.mockResolvedValue([fakeStudent("u1", "Alice")]);
    listAssessments.mockResolvedValue([
      fakeAssessment("a1", "HW 1", new Date("2026-03-01"), ["p1"]),
    ]);

    const out = await buildCourseGradebook("course_1", { forUserId: "ghost" });

    expect(out.rows).toEqual([]);
    expect(groupByUserAndProblem).not.toHaveBeenCalled();
  });
});
