import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  groupBestScoresByAssessment,
  groupAcceptedByAssessmentForUser,
  groupBestScoresByExam,
  groupAcceptedByExamForUser,
  countStudentsByCourse
} = vi.hoisted(() => ({
  groupBestScoresByAssessment: vi.fn(),
  groupAcceptedByAssessmentForUser: vi.fn(),
  groupBestScoresByExam: vi.fn(),
  groupAcceptedByExamForUser: vi.fn(),
  countStudentsByCourse: vi.fn()
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: {
    groupBestScoresByAssessment,
    groupAcceptedByAssessmentForUser,
    groupBestScoresByExam,
    groupAcceptedByExamForUser
  },
  courseMembershipRepo: { countStudentsByCourse }
}));

import {
  aggregateAssessmentClassStats,
  aggregateAssessmentMyStatus,
  aggregateExamClassStats,
  aggregateExamMyStatus
} from "@nojv/domain";

beforeEach(() => {
  groupBestScoresByAssessment.mockReset();
  groupAcceptedByAssessmentForUser.mockReset();
  groupBestScoresByExam.mockReset();
  groupAcceptedByExamForUser.mockReset();
  countStudentsByCourse.mockReset();
});

describe("aggregateAssessmentClassStats", () => {
  it("returns an empty map when input is empty", async () => {
    const out = await aggregateAssessmentClassStats([]);
    expect(out.size).toBe(0);
    expect(groupBestScoresByAssessment).not.toHaveBeenCalled();
  });

  it("computes submittedUsers / avgScore by summing best scores per user", async () => {
    groupBestScoresByAssessment.mockResolvedValue([
      // user A: 80 + 60 = 140
      { courseAssessmentId: "a1", userId: "uA", problemId: "p1", _max: { score: 80 } },
      { courseAssessmentId: "a1", userId: "uA", problemId: "p2", _max: { score: 60 } },
      // user B: 100 + 0 = 100
      { courseAssessmentId: "a1", userId: "uB", problemId: "p1", _max: { score: 100 } },
      { courseAssessmentId: "a1", userId: "uB", problemId: "p2", _max: { score: 0 } }
    ]);
    countStudentsByCourse.mockResolvedValue(new Map([["c1", 5]]));

    const out = await aggregateAssessmentClassStats([
      { id: "a1", courseId: "c1", problemCount: 2 }
    ]);
    expect(out.get("a1")).toEqual({
      submittedUsers: 2,
      totalStudents: 5,
      avgScore: 120 // (140 + 100) / 2
    });
  });

  it("returns submittedUsers=0 and avgScore=0 when no submissions exist", async () => {
    groupBestScoresByAssessment.mockResolvedValue([]);
    countStudentsByCourse.mockResolvedValue(new Map([["c1", 5]]));
    const out = await aggregateAssessmentClassStats([
      { id: "a1", courseId: "c1", problemCount: 3 }
    ]);
    expect(out.get("a1")).toEqual({ submittedUsers: 0, totalStudents: 5, avgScore: 0 });
  });

  it("falls back to totalStudents=0 when the course has no active student rows", async () => {
    groupBestScoresByAssessment.mockResolvedValue([]);
    countStudentsByCourse.mockResolvedValue(new Map());
    const out = await aggregateAssessmentClassStats([
      { id: "a1", courseId: "c1", problemCount: 1 }
    ]);
    expect(out.get("a1")?.totalStudents).toBe(0);
  });

  it("treats null _max.score (no scored submissions yet) as 0", async () => {
    groupBestScoresByAssessment.mockResolvedValue([
      { courseAssessmentId: "a1", userId: "uA", problemId: "p1", _max: { score: null } }
    ]);
    countStudentsByCourse.mockResolvedValue(new Map([["c1", 1]]));
    const out = await aggregateAssessmentClassStats([
      { id: "a1", courseId: "c1", problemCount: 1 }
    ]);
    expect(out.get("a1")).toEqual({ submittedUsers: 1, totalStudents: 1, avgScore: 0 });
  });
});

describe("aggregateAssessmentMyStatus", () => {
  it("returns an empty map when input is empty", async () => {
    const out = await aggregateAssessmentMyStatus("u1", []);
    expect(out.size).toBe(0);
    expect(groupAcceptedByAssessmentForUser).not.toHaveBeenCalled();
  });

  it("counts distinct accepted problems per assessment", async () => {
    groupAcceptedByAssessmentForUser.mockResolvedValue([
      { courseAssessmentId: "a1", problemId: "p1" },
      { courseAssessmentId: "a1", problemId: "p2" },
      { courseAssessmentId: "a2", problemId: "p3" }
    ]);
    const out = await aggregateAssessmentMyStatus("u1", [
      { id: "a1", problemCount: 5 },
      { id: "a2", problemCount: 3 }
    ]);
    expect(out.get("a1")).toEqual({ solved: 2, total: 5 });
    expect(out.get("a2")).toEqual({ solved: 1, total: 3 });
  });

  it("returns 0 solved when the user has no accepted submissions", async () => {
    groupAcceptedByAssessmentForUser.mockResolvedValue([]);
    const out = await aggregateAssessmentMyStatus("u1", [{ id: "a1", problemCount: 4 }]);
    expect(out.get("a1")).toEqual({ solved: 0, total: 4 });
  });
});

describe("aggregateExamClassStats", () => {
  it("matches the assessment shape but groups by examId", async () => {
    groupBestScoresByExam.mockResolvedValue([
      { examId: "e1", userId: "uA", problemId: "p1", _max: { score: 100 } },
      { examId: "e1", userId: "uB", problemId: "p1", _max: { score: 50 } }
    ]);
    countStudentsByCourse.mockResolvedValue(new Map([["c1", 10]]));
    const out = await aggregateExamClassStats([{ id: "e1", courseId: "c1", problemCount: 1 }]);
    expect(out.get("e1")).toEqual({ submittedUsers: 2, totalStudents: 10, avgScore: 75 });
  });
});

describe("aggregateExamMyStatus", () => {
  it("counts distinct accepted exam problems for the user", async () => {
    groupAcceptedByExamForUser.mockResolvedValue([
      { examId: "e1", problemId: "p1" },
      { examId: "e1", problemId: "p2" }
    ]);
    const out = await aggregateExamMyStatus("u1", [{ id: "e1", problemCount: 4 }]);
    expect(out.get("e1")).toEqual({ solved: 2, total: 4 });
  });
});
