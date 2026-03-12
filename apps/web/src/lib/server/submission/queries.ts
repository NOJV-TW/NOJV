import { prisma } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
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
  const problem = await prisma.problem.findUnique({
    where: { slug: problemSlug },
    select: { id: true }
  });

  if (!problem) return [];

  let courseAssessmentId: string | undefined;

  if (assessmentFilter) {
    const assessment = await prisma.courseAssessment.findFirst({
      where: {
        slug: assessmentFilter.assessmentSlug,
        course: { slug: assessmentFilter.courseSlug }
      },
      select: { id: true }
    });

    if (!assessment) return [];
    courseAssessmentId = assessment.id;
  }

  const submissions = await prisma.submission.findMany({
    where: {
      problemId: problem.id,
      userId,
      sampleOnly: false,
      status: {
        in: [
          "accepted",
          "wrong_answer",
          "compile_error",
          "runtime_error",
          "time_limit_exceeded",
          "memory_limit_exceeded"
        ]
      },
      ...(courseAssessmentId ? { courseAssessmentId } : {})
    },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      language: true,
      score: true,
      sourceCode: true,
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
      language: langParsed.success ? langParsed.data : s.language,
      result,
      sourceCode: s.sourceCode,
      submittedAt: s.createdAt.toISOString()
    };
  });
}
