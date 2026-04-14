import {
  assessmentRepo,
  contestRepo,
  plagiarismRepo,
  assessmentProblemRepo,
  submissionRepo,
  type PlagiarismReportSummary
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

// Plagiarism state is inlined on `Contest` / `CourseAssessment` as six
// `plagiarism*` columns — the parent id IS the report identity.
async function writePlagiarismFields(
  target: PlagiarismTarget,
  input: Parameters<typeof plagiarismRepo.upsertForContest>[1]
): Promise<void> {
  if (target.type === "contest") {
    await plagiarismRepo.upsertForContest(target.id, input);
  } else {
    await plagiarismRepo.upsertForAssessment(target.id, input);
  }
}

export async function updateReportStatus(
  target: PlagiarismTarget,
  status: PlagiarismReportStatus
): Promise<void> {
  await writePlagiarismFields(target, { status });
}

export async function saveResults(
  target: PlagiarismTarget,
  results: PlagiarismResults,
  mossReportUrl: string | null
): Promise<void> {
  await writePlagiarismFields(target, {
    status: "completed",
    results: toJsonValue(results),
    mossReportUrl,
    completedAt: new Date()
  });
}

export async function markReportFailed(target: PlagiarismTarget): Promise<void> {
  await writePlagiarismFields(target, {
    status: "failed",
    completedAt: new Date()
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

/**
 * Resolve the plagiarism target (course assessment or contest) from the assessmentId param.
 */
export async function resolvePlagiarismTarget(
  assessmentId: string,
  type: string | null
): Promise<ResolvedPlagiarismTarget> {
  if (type === "contest") {
    const contest = await contestRepo.findByIdWithCourse(assessmentId);
    if (!contest) throw new PlagiarismNotFoundError("Contest not found.");
    if (!contest.courseId || !contest.course) {
      throw new PlagiarismForbiddenError(
        "Plagiarism checks are only available for course-linked contests."
      );
    }
    return { courseId: contest.course.id, target: { id: contest.id, type: "contest" } };
  }

  const assessment = await assessmentRepo.findByIdWithCourseId(assessmentId);
  if (!assessment) throw new PlagiarismNotFoundError("Assessment not found.");
  return {
    courseId: assessment.course.id,
    target: { id: assessment.id, type: "courseAssessment" }
  };
}

export async function createPlagiarismReport(
  target: PlagiarismTarget,
  triggeredById: string
): Promise<PlagiarismReportSummary> {
  await writePlagiarismFields(target, {
    status: "pending",
    triggeredById,
    triggeredAt: new Date(),
    results: null,
    mossReportUrl: null,
    completedAt: null
  });
  // The upsert helper returns the parent row's six columns but the shape
  // differs from `PlagiarismReportSummary`, so re-read through the typed
  // `findBy*` to get the canonical summary (and to satisfy the non-null
  // contract — we just wrote a non-null status).
  const summary = await findPlagiarismReport(target);
  if (!summary) {
    throw new Error("Failed to persist plagiarism report state.");
  }
  return summary;
}

/**
 * Look up the single existing plagiarism report for a target, if any.
 * Returns `null` when MOSS has never been run.
 */
export async function findPlagiarismReport(
  target: PlagiarismTarget
): Promise<PlagiarismReportSummary | null> {
  if (target.type === "courseAssessment") {
    return plagiarismRepo.findByAssessmentId(target.id);
  }
  return plagiarismRepo.findByContestId(target.id);
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

// Returns 0 or 1 reports as an array so the route layer can keep its existing
// list-style UI loop without a special empty-state branch.
export async function listAssessmentPlagiarismReports(
  assessmentId: string
): Promise<PlagiarismReportSummary[]> {
  const report = await plagiarismRepo.findByAssessmentId(assessmentId);
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
