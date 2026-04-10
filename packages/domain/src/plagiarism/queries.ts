import {
  assessmentRepo,
  contestRepo,
  plagiarismReportRepo,
  assessmentProblemRepo,
  submissionRepo
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
  target: PlagiarismTarget
): Promise<PlagiarismSubmission[]> {
  return submissionRepo.findForPlagiarism({
    ...plagiarismTargetFilter(target),
    status: "accepted"
  });
}

type PlagiarismReportStatus = "pending" | "running" | "completed" | "failed";

export async function updateReportStatus(
  reportId: string,
  status: PlagiarismReportStatus
): Promise<void> {
  await plagiarismReportRepo.updateStatus(reportId, status);
}

export async function saveResults(
  reportId: string,
  results: PlagiarismResults,
  mossReportUrl: string | null
): Promise<void> {
  await plagiarismReportRepo.complete(reportId, {
    mossReportUrl,
    results: toJsonValue(results),
    status: "completed"
  });
}

export async function markReportFailed(reportId: string): Promise<void> {
  await plagiarismReportRepo.markFailed(reportId);
}

// ─── Route-level plagiarism functions ──────────────────────────────

export interface ResolvedPlagiarismTarget {
  target: PlagiarismTarget;
  courseSlug: string;
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

/**
 * Resolve the plagiarism target (course assessment or contest) from the assessmentId param.
 */
export async function resolvePlagiarismTarget(
  assessmentId: string,
  type: string | null
): Promise<ResolvedPlagiarismTarget> {
  if (type === "contest") {
    const contest = await contestRepo.findByIdWithCourseSlug(assessmentId);
    if (!contest) throw new PlagiarismNotFoundError("Contest not found.");
    if (!contest.courseId || !contest.course) {
      throw new PlagiarismForbiddenError(
        "Plagiarism checks are only available for course-linked contests."
      );
    }
    return { courseSlug: contest.course.slug, target: { id: contest.id, type: "contest" } };
  }

  const assessment = await assessmentRepo.findByIdWithCourseSlug(assessmentId);
  if (!assessment) throw new PlagiarismNotFoundError("Assessment not found.");
  return {
    courseSlug: assessment.course.slug,
    target: { id: assessment.id, type: "courseAssessment" }
  };
}

/**
 * Upsert the single plagiarism report for a target. PlagiarismReport is
 * 1:1 with its parent now: re-running MOSS overwrites the existing row,
 * there is no history. The repo `create` is upsert-flavored — the
 * unique-FK constraint on (contestId | courseAssessmentId) is what
 * makes the 1:1 invariant hold.
 */
export async function createPlagiarismReport(target: PlagiarismTarget, triggeredById: string) {
  return plagiarismReportRepo.create({
    ...(target.type === "courseAssessment"
      ? { courseAssessmentId: target.id }
      : { contestId: target.id }),
    status: "pending",
    triggeredById
  });
}

/**
 * Look up the single existing plagiarism report for a target, if any.
 * Returns `null` when MOSS has never been run.
 */
export async function findPlagiarismReport(target: PlagiarismTarget) {
  if (target.type === "courseAssessment") {
    return plagiarismReportRepo.findByAssessmentId(target.id);
  }
  return plagiarismReportRepo.findByContestId(target.id);
}

export async function getPlagiarismSourceCode(
  target: PlagiarismTarget,
  userId: string,
  problemId: string
) {
  const submission = await submissionRepo.findMany({
    where: {
      ...plagiarismTargetFilter(target),
      problemId,
      userId
    },
    orderBy: { score: "desc" },
    select: { sourceCode: true },
    take: 1
  });
  return submission[0]?.sourceCode ?? null;
}

/**
 * Get the single plagiarism report for a course assessment (plagiarism
 * manage page). Wrapper kept for backwards-compat with the route layer.
 */
export async function listAssessmentPlagiarismReports(assessmentId: string) {
  const report = await plagiarismReportRepo.findByAssessmentId(assessmentId);
  return report ? [report] : [];
}

/**
 * Get assessment problems with details (plagiarism manage page).
 */
export async function getAssessmentProblemMap(assessmentId: string) {
  const assessmentProblems = await assessmentProblemRepo.findByAssessmentId(assessmentId);
  return Object.fromEntries(
    assessmentProblems.map((ap) => [
      ap.problemId,
      { id: ap.problem.id, title: ap.problem.title }
    ])
  );
}
