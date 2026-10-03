import {
  assessmentRepo,
  contestRepo,
  examRepo,
  problemRepo,
  submissionRepo,
  type TransactionClient,
} from "@nojv/db";
import type { RejudgeInput } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError } from "../shared/errors";
import { isCourseStaff, isCourseStaffTx } from "../shared/permissions";

type SubmissionActor = Pick<ActorContext, "userId" | "platformRole">;

export async function canOperateOnSubmission(
  actor: SubmissionActor,
  submission: {
    id: string;
    userId: string;
    problemId: string;
    contestId?: string | null;
    assessmentId?: string | null;
    examId?: string | null;
  },
  tx?: TransactionClient,
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  if (submission.contestId) {
    const contest = await (tx ? contestRepo.withTx(tx) : contestRepo).findById(
      submission.contestId,
    );
    return contest?.createdByUserId === actor.userId;
  }

  if (submission.assessmentId) {
    const assignment = tx
      ? await assessmentRepo.withTx(tx).findById(submission.assessmentId)
      : await assessmentRepo.findByIdWithCourseId(submission.assessmentId);
    if (!assignment) return false;
    return tx
      ? isCourseStaffTx(tx, actor.userId, assignment.courseId)
      : isCourseStaff(actor.userId, assignment.courseId);
  }

  if (submission.examId) {
    const exam = await (tx ? examRepo.withTx(tx) : examRepo).findById(submission.examId);
    if (!exam) return false;
    return tx
      ? isCourseStaffTx(tx, actor.userId, exam.courseId)
      : isCourseStaff(actor.userId, exam.courseId);
  }

  const problem = await (tx ? problemRepo.withTx(tx) : problemRepo).findById(
    submission.problemId,
  );
  return problem?.authorId === actor.userId;
}

export async function assertCanOperateOnSubmission(
  actor: SubmissionActor,
  submission: {
    id: string;
    userId: string;
    problemId: string;
    contestId?: string | null;
    assessmentId?: string | null;
    examId?: string | null;
  },
  tx?: TransactionClient,
): Promise<void> {
  if (!(await canOperateOnSubmission(actor, submission, tx))) {
    throw new ForbiddenError("Not permitted to operate on this submission.");
  }
}

export async function assertBatchRejudgeAccess(
  actor: SubmissionActor,
  input: Extract<RejudgeInput, { mode: "batch" }>,
  tx?: TransactionClient,
): Promise<void> {
  if (actor.platformRole === "admin") return;

  if (input.contestId) {
    const contest = await (tx ? contestRepo.withTx(tx) : contestRepo).findById(input.contestId);
    if (contest?.createdByUserId !== actor.userId) {
      throw new ForbiddenError("Not the contest organizer.");
    }
    return;
  }

  if (input.assessmentId) {
    const assignment = tx
      ? await assessmentRepo.withTx(tx).findById(input.assessmentId)
      : await assessmentRepo.findByIdWithCourseId(input.assessmentId);
    if (
      !assignment ||
      !(tx
        ? await isCourseStaffTx(tx, actor.userId, assignment.courseId)
        : await isCourseStaff(actor.userId, assignment.courseId))
    ) {
      throw new ForbiddenError("Not course staff for this assignment.");
    }
    return;
  }

  if (input.examId) {
    const exam = await (tx ? examRepo.withTx(tx) : examRepo).findById(input.examId);
    if (
      !exam ||
      !(tx
        ? await isCourseStaffTx(tx, actor.userId, exam.courseId)
        : await isCourseStaff(actor.userId, exam.courseId))
    ) {
      throw new ForbiddenError("Not course staff for this exam.");
    }
    return;
  }

  const problem = await (tx ? problemRepo.withTx(tx) : problemRepo).findById(input.problemId);
  if (problem?.authorId !== actor.userId) {
    throw new ForbiddenError(
      "Batch rejudge without a context scope is limited to the problem author.",
    );
  }

  const anyNonPractice = tx
    ? (await tx.submission.findFirst({
        where: {
          problemId: input.problemId,
          OR: [
            { contestId: { not: null } },
            { assessmentId: { not: null } },
            { examId: { not: null } },
          ],
        },
        select: { id: true },
      })) !== null
    : await submissionRepo.anyWithContextForProblem(input.problemId);
  if (anyNonPractice) {
    throw new ForbiddenError(
      "Batch rejudge includes non-practice submissions; scope to a specific context.",
    );
  }
}
