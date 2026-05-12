import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  groupBestScoresByAssessment,
  groupAcceptedByAssessmentForUser,
  groupBestScoresByAssessmentForUser,
  groupBestScoresByExam,
  groupAcceptedByExamForUser,
  groupBestScoresByExamForUser,
  countStudentsByCourse,
  sumPointsByAssessment,
  sumPointsByExam,
} = vi.hoisted(() => ({
  groupBestScoresByAssessment: vi.fn(),
  groupAcceptedByAssessmentForUser: vi.fn(),
  groupBestScoresByAssessmentForUser: vi.fn(),
  groupBestScoresByExam: vi.fn(),
  groupAcceptedByExamForUser: vi.fn(),
  groupBestScoresByExamForUser: vi.fn(),
  countStudentsByCourse: vi.fn(),
  sumPointsByAssessment: vi.fn(),
  sumPointsByExam: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: {
    groupBestScoresByAssessment,
    groupAcceptedByAssessmentForUser,
    groupBestScoresByAssessmentForUser,
    groupBestScoresByExam,
    groupAcceptedByExamForUser,
    groupBestScoresByExamForUser,
  },
  courseMembershipRepo: { countStudentsByCourse },
  assessmentProblemRepo: { sumPointsByAssessment },
  examProblemRepo: { sumPointsByExam },
}));

import {
  aggregateAssessmentClassStats,
  aggregateAssessmentMyStatus,
  aggregateExamClassStats,
  aggregateExamMyStatus,
} from "@nojv/domain";

beforeEach(() => {
  groupBestScoresByAssessment.mockReset();
  groupAcceptedByAssessmentForUser.mockReset();
  groupBestScoresByAssessmentForUser.mockReset();
  groupBestScoresByExam.mockReset();
  groupAcceptedByExamForUser.mockReset();
  groupBestScoresByExamForUser.mockReset();
  countStudentsByCourse.mockReset();
  sumPointsByAssessment.mockReset();
  sumPointsByExam.mockReset();
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
      { courseAssessmentId: "a1", userId: "uB", problemId: "p2", _max: { score: 0 } },
    ]);
    countStudentsByCourse.mockResolvedValue(new Map([["c1", 5]]));

    const out = await aggregateAssessmentClassStats([
      { id: "a1", courseId: "c1", problemCount: 2 },
    ]);
    expect(out.get("a1")).toEqual({
      submittedUsers: 2,
      totalStudents: 5,
      avgScore: 120, // (140 + 100) / 2
    });
  });

  it("returns submittedUsers=0 and avgScore=0 when no submissions exist", async () => {
    groupBestScoresByAssessment.mockResolvedValue([]);
    countStudentsByCourse.mockResolvedValue(new Map([["c1", 5]]));
    const out = await aggregateAssessmentClassStats([
      { id: "a1", courseId: "c1", problemCount: 3 },
    ]);
    expect(out.get("a1")).toEqual({ submittedUsers: 0, totalStudents: 5, avgScore: 0 });
  });

  it("falls back to totalStudents=0 when the course has no active student rows", async () => {
    groupBestScoresByAssessment.mockResolvedValue([]);
    countStudentsByCourse.mockResolvedValue(new Map());
    const out = await aggregateAssessmentClassStats([
      { id: "a1", courseId: "c1", problemCount: 1 },
    ]);
    expect(out.get("a1")?.totalStudents).toBe(0);
  });

  it("treats null _max.score (no scored submissions yet) as 0", async () => {
    groupBestScoresByAssessment.mockResolvedValue([
      { courseAssessmentId: "a1", userId: "uA", problemId: "p1", _max: { score: null } },
    ]);
    countStudentsByCourse.mockResolvedValue(new Map([["c1", 1]]));
    const out = await aggregateAssessmentClassStats([
      { id: "a1", courseId: "c1", problemCount: 1 },
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

  it("counts distinct accepted problems and sums best scores per assessment", async () => {
    groupAcceptedByAssessmentForUser.mockResolvedValue([
      { courseAssessmentId: "a1", problemId: "p1" },
      { courseAssessmentId: "a1", problemId: "p2" },
      { courseAssessmentId: "a2", problemId: "p3" },
    ]);
    groupBestScoresByAssessmentForUser.mockResolvedValue([
      { courseAssessmentId: "a1", problemId: "p1", _max: { score: 80 } },
      { courseAssessmentId: "a1", problemId: "p2", _max: { score: 60 } },
      { courseAssessmentId: "a2", problemId: "p3", _max: { score: 100 } },
    ]);
    sumPointsByAssessment.mockResolvedValue([
      { assessmentId: "a1", _sum: { points: 200 } },
      { assessmentId: "a2", _sum: { points: 100 } },
    ]);
    const out = await aggregateAssessmentMyStatus("u1", [
      { id: "a1", problemCount: 5 },
      { id: "a2", problemCount: 3 },
    ]);
    expect(out.get("a1")).toEqual({ solved: 2, total: 5, score: 140, totalPoints: 200 });
    expect(out.get("a2")).toEqual({ solved: 1, total: 3, score: 100, totalPoints: 100 });
  });

  it("returns zeros when the user has no submissions and points haven't been set", async () => {
    groupAcceptedByAssessmentForUser.mockResolvedValue([]);
    groupBestScoresByAssessmentForUser.mockResolvedValue([]);
    sumPointsByAssessment.mockResolvedValue([]);
    const out = await aggregateAssessmentMyStatus("u1", [{ id: "a1", problemCount: 4 }]);
    expect(out.get("a1")).toEqual({ solved: 0, total: 4, score: 0, totalPoints: 0 });
  });
});

describe("aggregateExamClassStats", () => {
  it("matches the assessment shape but groups by examId", async () => {
    groupBestScoresByExam.mockResolvedValue([
      { examId: "e1", userId: "uA", problemId: "p1", _max: { score: 100 } },
      { examId: "e1", userId: "uB", problemId: "p1", _max: { score: 50 } },
    ]);
    countStudentsByCourse.mockResolvedValue(new Map([["c1", 10]]));
    const out = await aggregateExamClassStats([{ id: "e1", courseId: "c1", problemCount: 1 }]);
    expect(out.get("e1")).toEqual({ submittedUsers: 2, totalStudents: 10, avgScore: 75 });
  });
});

describe("aggregateExamMyStatus", () => {
  it("counts distinct accepted exam problems and sums best scores for the user", async () => {
    groupAcceptedByExamForUser.mockResolvedValue([
      { examId: "e1", problemId: "p1" },
      { examId: "e1", problemId: "p2" },
    ]);
    groupBestScoresByExamForUser.mockResolvedValue([
      { examId: "e1", problemId: "p1", _max: { score: 100 } },
      { examId: "e1", problemId: "p2", _max: { score: 40 } },
    ]);
    sumPointsByExam.mockResolvedValue([{ examId: "e1", _sum: { points: 200 } }]);
    const out = await aggregateExamMyStatus("u1", [{ id: "e1", problemCount: 4 }]);
    expect(out.get("e1")).toEqual({ solved: 2, total: 4, score: 140, totalPoints: 200 });
  });
});
