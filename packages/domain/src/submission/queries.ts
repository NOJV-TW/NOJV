import { assessmentRepo, problemRepo, submissionRepo } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";

export async function getSubmissionForUser(
  submissionId: string,
  userId: string,
  isAdmin: boolean
) {
  const submission = await submissionRepo.findById(submissionId);

  if (!submission) {
    throw new NotFoundError("Submission not found.");
  }

  if (submission.userId !== userId && !isAdmin) {
    throw new NotFoundError("Submission not found.");
  }

  return submission;
}

export async function listUserSubmissions(userId: string) {
  const submissions = await submissionRepo.listByUser({ userId });

  return submissions.map((s) => {
    const language = languageSchema.parse(s.language);

    return {
      createdAt: s.createdAt.toISOString(),
      id: s.id,
      language,
      problemId: s.problem.id,
      problemTitle: s.problem.title,
      runtimeMs: s.runtimeMs,
      score: s.score,
      status: s.status
    };
  });
}

export async function listProblemSubmissions(
  userId: string,
  problemId: string,
  assessmentFilter?: { assessmentSlug: string; courseId: string }
) {
  const problemP = problemRepo.findById(problemId);

  const assessmentP = assessmentFilter
    ? assessmentRepo.findByCourseAndSlug(
        assessmentFilter.courseId,
        assessmentFilter.assessmentSlug
      )
    : null;

  const [problem, assessment] = await Promise.all([problemP, assessmentP]);

  if (!problem) return [];
  if (assessmentFilter && !assessment) return [];

  const courseAssessmentId = assessment?.id;

  const submissions = await submissionRepo.listByUserAndProblem({
    problemId: problem.id,
    userId,
    statusIn: [...submissionVerdicts],
    ...(courseAssessmentId ? { courseAssessmentId } : {})
  });

  return submissions.map((s) => {
    // verdictDetail is the sole source of truth; `s.status` is validated to surface enum-column corruption.
    submissionVerdictSchema.parse(s.status);
    const result = submissionResultSchema.parse(s.verdictDetail);
    const language = languageSchema.parse(s.language);

    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString()
    };
  });
}
