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

export async function listProblemSubmissions(
  userId: string,
  problemId: string,
  assessmentFilter?: { assessmentSlug: string; courseSlug: string }
) {
  const problemP = problemRepo.findById(problemId);

  const assessmentP = assessmentFilter
    ? assessmentRepo.findByCourseAndSlug(
        assessmentFilter.courseSlug,
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
    // verdictDetail is the sole source of truth for case results,
    // subtask results, compiler output, etc. We still validate
    // `s.status` up front so DB corruption at the enum column is
    // surfaced rather than hidden.
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
