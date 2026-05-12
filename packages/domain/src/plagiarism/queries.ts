import {
  assessmentRepo,
  contestRepo,
  examRepo,
  plagiarismRepo,
  assessmentProblemRepo,
  submissionRepo,
  type PlagiarismReportSummary,
} from "@nojv/db";

import { NotFoundError } from "../shared/errors";
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

// Plagiarism state is inlined on `Exam` / `Contest` / `CourseAssessment` as
// six `plagiarism*` columns — the parent id IS the report identity.
async function writePlagiarismFields(
  target: PlagiarismTarget,
  input: Parameters<typeof plagiarismRepo.upsertForExam>[1],
): Promise<void> {
  if (target.type === "exam") {
    await plagiarismRepo.upsertForExam(target.id, input);
  } else if (target.type === "contest") {
    await plagiarismRepo.upsertForContest(target.id, input);
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

export async function resolvePlagiarismTarget(
  targetId: string,
  type: string | null,
): Promise<ResolvedPlagiarismTarget> {
  if (type === "exam") {
    const exam = await examRepo.findByIdWithCourse(targetId);
    if (!exam) throw new NotFoundError("Exam not found.");
    return { courseId: exam.courseId, target: { id: exam.id, type: "exam" } };
  }

  if (type === "contest") {
    const contest = await contestRepo.findById(targetId);
    if (!contest) throw new NotFoundError("Contest not found.");
    // Contests are not course-bound; surface an empty courseId so callers
    // that key off course membership fall back to platform-role checks.
    return { courseId: "", target: { id: contest.id, type: "contest" } };
  }

  const assignment = await assessmentRepo.findByIdWithCourseId(targetId);
  if (!assignment) throw new NotFoundError("Assignment not found.");
  return {
    courseId: assignment.course.id,
    target: { id: assignment.id, type: "courseAssessment" },
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
  if (target.type === "contest") {
    return plagiarismRepo.findByContestId(target.id);
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
export async function listAssignmentPlagiarismReports(
  assignmentId: string,
): Promise<PlagiarismReportSummary[]> {
  const report = await plagiarismRepo.findByAssessmentId(assignmentId);
  return report ? [report] : [];
}

export async function getAssignmentProblemMap(assignmentId: string) {
  const assignmentProblems = await assessmentProblemRepo.findByAssessmentId(assignmentId);
  return Object.fromEntries(
    assignmentProblems.map((ap) => [
      ap.problemId,
      { id: ap.problem.id, title: ap.problem.title },
    ]),
  );
}
