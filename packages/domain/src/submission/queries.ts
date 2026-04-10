import { assessmentRepo, problemRepo, submissionRepo } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema,
  type SubmissionResult
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
    const verdictParsed = submissionVerdictSchema.safeParse(s.status);
    const verdict = verdictParsed.success ? verdictParsed.data : ("wrong_answer" as const);

    // verdictDetail is the sole source of truth for case results,
    // subtask results, compiler output, etc. There are no fallback
    // columns to merge any more.
    const detailParsed = submissionResultSchema.safeParse(s.verdictDetail);
    const result: SubmissionResult = detailParsed.success
      ? detailParsed.data
      : {
          accepted: s.status === "accepted",
          caseResults: undefined,
          feedback: s.status.replace(/_/g, " "),
          runtimeMs: s.runtimeMs ?? 0,
          score: s.score,
          verdict
        };

    const langParsed = languageSchema.safeParse(s.language);

    return {
      id: s.id,
      language: langParsed.success ? langParsed.data : s.language,
      result,
      submittedAt: s.createdAt.toISOString()
    };
  });
}
