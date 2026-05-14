import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindByIdWithCourse,
  assessmentFindByIdWithCourseId,
  contestFindById,
  upsertForExam,
  upsertForAssessment,
  upsertForContest,
  findByAssessmentId,
  findByExamId,
  findByContestId,
} = vi.hoisted(() => ({
  examFindByIdWithCourse: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  contestFindById: vi.fn(),
  upsertForExam: vi.fn(),
  upsertForAssessment: vi.fn(),
  upsertForContest: vi.fn(),
  findByAssessmentId: vi.fn(),
  findByExamId: vi.fn(),
  findByContestId: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  examRepo: { findByIdWithCourse: examFindByIdWithCourse },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  contestRepo: { findById: contestFindById },
  plagiarismRepo: {
    upsertForExam,
    upsertForAssessment,
    upsertForContest,
    findByAssessmentId,
    findByExamId,
    findByContestId,
  },
  assessmentProblemRepo: {},
  submissionRepo: {},
}));

import { NotFoundError, plagiarismDomain } from "@nojv/domain";

const { getPlagiarismTarget, createPlagiarismReport } = plagiarismDomain;

beforeEach(() => {
  examFindByIdWithCourse.mockReset();
  assessmentFindByIdWithCourseId.mockReset();
  contestFindById.mockReset();
  upsertForExam.mockReset();
  upsertForAssessment.mockReset();
  upsertForContest.mockReset();
  findByAssessmentId.mockReset();
  findByExamId.mockReset();
  findByContestId.mockReset();
});

describe("getPlagiarismTarget", () => {
  it("resolves type='exam' to an exam target", async () => {
    examFindByIdWithCourse.mockResolvedValue({ id: "exam_1", courseId: "crs_1" });
    const result = await getPlagiarismTarget("exam_1", "exam");
    expect(result).toEqual({ courseId: "crs_1", target: { id: "exam_1", type: "exam" } });
    expect(examFindByIdWithCourse).toHaveBeenCalledWith("exam_1");
    expect(assessmentFindByIdWithCourseId).not.toHaveBeenCalled();
  });

  it("throws 'Exam not found.' when type='exam' and the row is missing", async () => {
    examFindByIdWithCourse.mockResolvedValue(null);
    await expect(getPlagiarismTarget("exam_missing", "exam")).rejects.toThrow(NotFoundError);
    await expect(getPlagiarismTarget("exam_missing", "exam")).rejects.toThrow(
      "Exam not found.",
    );
  });

  it("resolves type='contest' to a contest target with empty courseId", async () => {
    contestFindById.mockResolvedValue({ id: "ctst_1", createdByUserId: "u1" });
    const result = await getPlagiarismTarget("ctst_1", "contest");
    expect(result).toEqual({ courseId: "", target: { id: "ctst_1", type: "contest" } });
    expect(contestFindById).toHaveBeenCalledWith("ctst_1");
    expect(examFindByIdWithCourse).not.toHaveBeenCalled();
    expect(assessmentFindByIdWithCourseId).not.toHaveBeenCalled();
  });

  it("throws 'Contest not found.' when type='contest' and the row is missing", async () => {
    contestFindById.mockResolvedValue(null);
    await expect(getPlagiarismTarget("ctst_missing", "contest")).rejects.toThrow(
      "Contest not found.",
    );
  });

  it("resolves a missing type to a courseAssessment target", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "asg_1",
      course: { id: "crs_1" },
    });
    const result = await getPlagiarismTarget("asg_1", null);
    expect(result).toEqual({
      courseId: "crs_1",
      target: { id: "asg_1", type: "courseAssessment" },
    });
    expect(examFindByIdWithCourse).not.toHaveBeenCalled();
  });

  it("throws 'Assignment not found.' when no type and the assignment is missing", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue(null);
    await expect(getPlagiarismTarget("asg_missing", null)).rejects.toThrow(
      "Assignment not found.",
    );
  });
});

describe("createPlagiarismReport", () => {
  it("pre-wipes prior results + sets pending status + records triggerer", async () => {
    const summary = { status: "pending" };
    findByExamId.mockResolvedValue(summary);

    await createPlagiarismReport({ id: "exam_1", type: "exam" }, "usr_teacher");

    expect(upsertForExam).toHaveBeenCalledTimes(1);
    const [id, input] = upsertForExam.mock.calls[0];
    expect(id).toBe("exam_1");
    expect(input).toMatchObject({
      status: "pending",
      triggeredById: "usr_teacher",
      results: null,
      reportUrl: null,
      completedAt: null,
    });
    expect(input.triggeredAt).toBeInstanceOf(Date);
  });

  it("routes courseAssessment targets through upsertForAssessment", async () => {
    findByAssessmentId.mockResolvedValue({ status: "pending" });
    await createPlagiarismReport({ id: "asg_1", type: "courseAssessment" }, "usr_teacher");
    expect(upsertForAssessment).toHaveBeenCalledTimes(1);
    expect(upsertForExam).not.toHaveBeenCalled();
  });

  it("throws when the subsequent findPlagiarismReport returns null", async () => {
    findByExamId.mockResolvedValue(null);
    await expect(
      createPlagiarismReport({ id: "exam_1", type: "exam" }, "usr_teacher"),
    ).rejects.toThrow("Failed to persist plagiarism report state.");
  });
});
