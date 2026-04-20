import {
  assessmentRepo,
  examRepo,
  plagiarismRepo,
  assessmentProblemRepo,
  submissionRepo,
  type PlagiarismReportSummary,
} from "@nojv/db";

import { toJsonValue } from "../shared/to-json-value";
import { plagiarismTargetFilter, type PlagiarismResults, type PlagiarismTarget } from "./types";

export interface PlagiarismSubmission {
  id: string;
  language: string;
  problemId: string;
  score: number;
  sourceCode: string;
  userId: string;
}

export async function fetchSubmissionsForCheck(
  target: PlagiarismTarget,
): Promise<PlagiarismSubmission[]> {
  return submissionRepo.findForPlagiarism({
    ...plagiarismTargetFilter(target),
    status: "accepted",
  });
}

type PlagiarismReportStatus = "pending" | "running" | "completed" | "failed";

// Plagiarism state is inlined on `Exam` / `CourseAssessment` as six
// `plagiarism*` columns — the parent id IS the report identity.
async function writePlagiarismFields(
  target: PlagiarismTarget,
  input: Parameters<typeof plagiarismRepo.upsertForExam>[1],
): Promise<void> {
  if (target.type === "exam") {
    await plagiarismRepo.upsertForExam(target.id, input);
  } else {
    await plagiarismRepo.upsertForAssessment(target.id, input);
  }
}

export async function updateReportStatus(
  target: PlagiarismTarget,
  status: PlagiarismReportStatus,
): Promise<void> {
  await writePlagiarismFields(target, { status });
}

export async function saveResults(
  target: PlagiarismTarget,
  results: PlagiarismResults,
  reportUrl: string | null,
): Promise<void> {
  await writePlagiarismFields(target, {
    status: "completed",
    results: toJsonValue(results),
    reportUrl,
    completedAt: new Date(),
  });
}

export async function markReportFailed(target: PlagiarismTarget): Promise<void> {
  await writePlagiarismFields(target, {
    status: "failed",
    completedAt: new Date(),
  });
}

export interface ResolvedPlagiarismTarget {
  target: PlagiarismTarget;
  courseId: string;
}

export class PlagiarismNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlagiarismNotFoundError";
  }
}

export class PlagiarismForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlagiarismForbiddenError";
  }
}

// `type` accepts both "exam" and legacy "contest" for backwards compat.
export async function resolvePlagiarismTarget(
  assessmentId: string,
  type: string | null,
): Promise<ResolvedPlagiarismTarget> {
  if (type === "exam" || type === "contest") {
    const exam = await examRepo.findByIdWithCourse(assessmentId);
    if (!exam) throw new PlagiarismNotFoundError("Exam not found.");
    return { courseId: exam.courseId, target: { id: exam.id, type: "exam" } };
  }

  const assessment = await assessmentRepo.findByIdWithCourseId(assessmentId);
  if (!assessment) throw new PlagiarismNotFoundError("Assessment not found.");
  return {
    courseId: assessment.course.id,
    target: { id: assessment.id, type: "courseAssessment" },
  };
}

export async function createPlagiarismReport(
  target: PlagiarismTarget,
  triggeredById: string,
): Promise<PlagiarismReportSummary> {
  await writePlagiarismFields(target, {
    status: "pending",
    triggeredById,
    triggeredAt: new Date(),
    results: null,
    reportUrl: null,
    completedAt: null,
  });
  const summary = await findPlagiarismReport(target);
  if (!summary) {
    throw new Error("Failed to persist plagiarism report state.");
  }
  return summary;
}

export async function findPlagiarismReport(
  target: PlagiarismTarget,
): Promise<PlagiarismReportSummary | null> {
  if (target.type === "courseAssessment") {
    return plagiarismRepo.findByAssessmentId(target.id);
  }
  return plagiarismRepo.findByExamId(target.id);
}

export async function getPlagiarismSourceCode(
  target: PlagiarismTarget,
  userId: string,
  problemId: string,
) {
  const submission = await submissionRepo.findMany({
    where: {
      ...plagiarismTargetFilter(target),
      problemId,
      userId,
    },
    orderBy: { score: "desc" },
    select: { sourceCode: true },
    take: 1,
  });
  return submission[0]?.sourceCode ?? null;
}

// Returns 0 or 1 reports as an array so the route layer can keep its existing
// list-style UI loop without a special empty-state branch.
export async function listAssessmentPlagiarismReports(
  assessmentId: string,
): Promise<PlagiarismReportSummary[]> {
  const report = await plagiarismRepo.findByAssessmentId(assessmentId);
  return report ? [report] : [];
}

export async function getAssessmentProblemMap(assessmentId: string) {
  const assessmentProblems = await assessmentProblemRepo.findByAssessmentId(assessmentId);
  return Object.fromEntries(
    assessmentProblems.map((ap) => [
      ap.problemId,
      { id: ap.problem.id, title: ap.problem.title },
    ]),
  );
}
