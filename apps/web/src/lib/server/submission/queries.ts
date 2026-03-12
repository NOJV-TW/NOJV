import { prisma } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema,
  type SubmissionResult
} from "@nojv/core";

import { NotFoundError } from "../auth";

export async function getSubmissionForUser(
  submissionId: string,
  userId: string,
  isAdmin: boolean
) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId }
  });

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
  const problemP = prisma.problem.findUnique({
    where: { slug: problemSlug },
    select: { id: true }
  });

  const assessmentP = assessmentFilter
    ? prisma.courseAssessment.findFirst({
        where: {
          slug: assessmentFilter.assessmentSlug,
          course: { slug: assessmentFilter.courseSlug }
        },
        select: { id: true }
      })
    : null;

  const [problem, assessment] = await Promise.all([problemP, assessmentP]);

  if (!problem) return [];
  if (assessmentFilter && !assessment) return [];

  const courseAssessmentId = assessment?.id;

  const submissions = await prisma.submission.findMany({
    where: {
      problemId: problem.id,
      userId,
      sampleOnly: false,
      status: { in: [...submissionVerdicts] },
      ...(courseAssessmentId ? { courseAssessmentId } : {})
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      language: true,
      score: true,
      status: true,
      runtimeMs: true,
      verdictDetail: true
    },
    take: 50
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

    const langParsed = languageSchema.safeParse(s.language);

    return {
      id: s.id,
      language: langParsed.success ? langParsed.data : s.language,
      result,
      submittedAt: s.createdAt.toISOString()
    };
  });
}
