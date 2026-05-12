import { assessmentRepo, problemRepo, submissionRepo } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema,
} from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { NotFoundError } from "../shared/errors";
import { canOperateOnSubmission } from "./authz";

export async function getSubmissionForUser(
  submissionId: string,
  userId: string,
  isAdmin: boolean,
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

/**
 * Thin wrapper around `submissionRepo.findById` — used by the rejudge
 * endpoint to load the submission row before the authz check. Returns
 * null on miss; callers surface a 404.
 */
export async function getSubmissionById(id: string) {
  return submissionRepo.findById(id);
}

/**
 * Full detail payload for the submission dashboard page.
 *
 * Access rule:
 *   - submission owner → always
 *   - else → delegates to `canOperateOnSubmission` (admin / contest
 *     organizer / course staff / problem author)
 *
 * Staff-only flag `viewerIsStaff` tells the UI whether to expose the
 * submitter's identity; the owner viewing their own submission doesn't
 * see that section.
 */
export async function getSubmissionDetail(actor: ActorContext, submissionId: string) {
  const submission = await submissionRepo.findByIdForDetail(submissionId);
  if (!submission) throw new NotFoundError("Submission not found.");

  const isOwner = submission.userId === actor.userId;
  const viewerIsStaff = !isOwner && (await canOperateOnSubmission(actor, submission));

  if (!isOwner && !viewerIsStaff) {
    throw new NotFoundError("Submission not found.");
  }

  const language = languageSchema.parse(submission.language);
  submissionVerdictSchema.parse(submission.status);

  // Pre-terminal submissions (queued/compiling/running) have no verdictDetail.
  const parsedResult = submissionResultSchema.safeParse(submission.verdictDetail);
  const result = parsedResult.success ? parsedResult.data : null;

  return {
    id: submission.id,
    createdAt: submission.createdAt.toISOString(),
    language,
    sourceCode: submission.sourceCode,
    status: submission.status,
    score: submission.score,
    runtimeMs: submission.runtimeMs,
    memoryKb: submission.memoryKb,
    sampleOnly: submission.sampleOnly,
    result,
    problem: submission.problem,
    context: buildSubmissionContext(submission),
    submitter: viewerIsStaff
      ? { name: submission.user.name, username: submission.user.username }
      : null,
    viewerIsStaff,
  };
}

function buildSubmissionContext(submission: {
  contestId: string | null;
  contest: { id: string; title: string } | null;
  courseAssessmentId: string | null;
  courseAssessment: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; title: string };
  } | null;
  examId: string | null;
  exam: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; title: string };
  } | null;
}) {
  if (submission.contest) {
    return {
      kind: "contest" as const,
      contestId: submission.contest.id,
      contestTitle: submission.contest.title,
    };
  }
  if (submission.courseAssessment) {
    return {
      kind: "assessment" as const,
      assessmentId: submission.courseAssessment.id,
      assessmentTitle: submission.courseAssessment.title,
      courseId: submission.courseAssessment.course.id,
      courseTitle: submission.courseAssessment.course.title,
    };
  }
  if (submission.exam) {
    return {
      kind: "exam" as const,
      examId: submission.exam.id,
      examTitle: submission.exam.title,
      courseId: submission.exam.course.id,
      courseTitle: submission.exam.course.title,
    };
  }
  return { kind: "practice" as const };
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
      status: s.status,
    };
  });
}

/**
 * How many submissions the user has made against an assessment since UTC
 * midnight. Matches the boundary used by the daily-quota gate in
 * `createQueuedSubmissionRecord` so the displayed count and the enforced
 * count agree.
 */
export async function countAssessmentSubmissionsToday(
  userId: string,
  assessmentId: string,
): Promise<number> {
  const now = new Date();
  const startOfDayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  return submissionRepo.countForUserAndAssessmentSince(userId, assessmentId, startOfDayUtc);
}

export async function listProblemSubmissions(
  userId: string,
  problemId: string,
  assessmentFilter?: { assessmentId: string; courseId: string },
) {
  const problemP = problemRepo.findById(problemId);

  const assessmentP = assessmentFilter
    ? assessmentRepo.findByCourseAndId(assessmentFilter.courseId, assessmentFilter.assessmentId)
    : null;

  const [problem, assessment] = await Promise.all([problemP, assessmentP]);

  if (!problem) return [];
  if (assessmentFilter && !assessment) return [];

  const courseAssessmentId = assessment?.id;

  const submissions = await submissionRepo.listByUserAndProblem({
    problemId: problem.id,
    userId,
    statusIn: [...submissionVerdicts],
    ...(courseAssessmentId ? { courseAssessmentId } : {}),
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
      submittedAt: s.createdAt.toISOString(),
    };
  });
}
