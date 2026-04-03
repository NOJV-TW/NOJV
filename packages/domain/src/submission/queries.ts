import { assessmentRepo, problemRepo, submissionRepo } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
  subtaskResultItemSchema,
  submissionVerdicts,
  submissionVerdictSchema,
  type SubmissionResult
} from "@nojv/core";
import { z } from "zod";

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
  problemSlug: string,
  assessmentFilter?: { assessmentSlug: string; courseSlug: string }
) {
  const problemP = problemRepo.findIdBySlug(problemSlug);

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

    // Merge subtaskResults from the separate DB column if not already in verdictDetail
    if (!result.subtaskResults && s.subtaskResults) {
      const parsed = z.array(subtaskResultItemSchema).safeParse(s.subtaskResults);
      if (parsed.success) {
        result.subtaskResults = parsed.data;
      }
    }

    const langParsed = languageSchema.safeParse(s.language);

    return {
      id: s.id,
      language: langParsed.success ? langParsed.data : s.language,
      result,
      submittedAt: s.createdAt.toISOString()
    };
  });
}
