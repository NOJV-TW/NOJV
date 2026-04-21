import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindByIdWithCourse,
  assessmentFindByIdWithCourseId,
  upsertForExam,
  upsertForAssessment,
  findByAssessmentId,
  findByExamId,
} = vi.hoisted(() => ({
  examFindByIdWithCourse: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  upsertForExam: vi.fn(),
  upsertForAssessment: vi.fn(),
  findByAssessmentId: vi.fn(),
  findByExamId: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  examRepo: { findByIdWithCourse: examFindByIdWithCourse },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  plagiarismRepo: {
    upsertForExam,
    upsertForAssessment,
    findByAssessmentId,
    findByExamId,
  },
  assessmentProblemRepo: {},
  submissionRepo: {},
}));

import { NotFoundError, plagiarismDomain } from "@nojv/domain";

const { resolvePlagiarismTarget, createPlagiarismReport } = plagiarismDomain;

beforeEach(() => {
  examFindByIdWithCourse.mockReset();
  assessmentFindByIdWithCourseId.mockReset();
  upsertForExam.mockReset();
  upsertForAssessment.mockReset();
  findByAssessmentId.mockReset();
  findByExamId.mockReset();
});

describe("resolvePlagiarismTarget", () => {
  it("resolves type='exam' to an exam target", async () => {
    examFindByIdWithCourse.mockResolvedValue({ id: "exam_1", courseId: "crs_1" });
    const result = await resolvePlagiarismTarget("exam_1", "exam");
    expect(result).toEqual({ courseId: "crs_1", target: { id: "exam_1", type: "exam" } });
    expect(examFindByIdWithCourse).toHaveBeenCalledWith("exam_1");
    expect(assessmentFindByIdWithCourseId).not.toHaveBeenCalled();
  });

  it("throws 'Exam not found.' when type='exam' and the row is missing", async () => {
    examFindByIdWithCourse.mockResolvedValue(null);
    await expect(resolvePlagiarismTarget("exam_missing", "exam")).rejects.toThrow(
      NotFoundError,
    );
    await expect(resolvePlagiarismTarget("exam_missing", "exam")).rejects.toThrow(
      "Exam not found.",
    );
  });

  it("remaps legacy type='contest' to the exam repo", async () => {
    examFindByIdWithCourse.mockResolvedValue({ id: "exam_2", courseId: "crs_2" });
    const result = await resolvePlagiarismTarget("exam_2", "contest");
    expect(result.target.type).toBe("exam");
    expect(examFindByIdWithCourse).toHaveBeenCalledWith("exam_2");
    expect(assessmentFindByIdWithCourseId).not.toHaveBeenCalled();
  });

  it("resolves a missing type to a courseAssessment target", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "asg_1",
      course: { id: "crs_1" },
    });
    const result = await resolvePlagiarismTarget("asg_1", null);
    expect(result).toEqual({
      courseId: "crs_1",
      target: { id: "asg_1", type: "courseAssessment" },
    });
    expect(examFindByIdWithCourse).not.toHaveBeenCalled();
  });

  it("throws 'Assessment not found.' when no type and the assessment is missing", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue(null);
    await expect(resolvePlagiarismTarget("asg_missing", null)).rejects.toThrow(
      "Assessment not found.",
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
