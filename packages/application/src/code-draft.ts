import {
  assessmentProblemRepo,
  assessmentRepo,
  codeDraftRepo,
  contestProblemRepo,
  contestRepo,
  courseMembershipRepo,
  courseRepo,
  examProblemRepo,
  examRepo,
  examSessionRepo,
  problemRepo,
} from "@nojv/db";
import type { CodeDraftSave, CodeDraftScope, SubmissionContext } from "@nojv/core";

import type { ActorContext } from "./shared/actor-context";
import { ForbiddenError, NotFoundError } from "./shared/errors";
import { assertProblemViewAccess } from "./problem/permissions";
import { assertCanSubmitToVirtualContest } from "./virtual-contest/queries";
import { checkProctoringGate } from "./proctoring/gate";

export function codeDraftContextKey(context: SubmissionContext): string {
  switch (context.type) {
    case "practice":
      return "practice";
    case "assignment":
      return `assignment:${context.assessmentId}`;
    case "exam":
      return `exam:${context.examId}`;
    case "contest":
      return `contest:${context.contestId}`;
    case "virtual":
      return `virtual:${context.participationId}`;
  }
}

export async function assertProblemContextAllowed(
  actor: ActorContext,
  scope: CodeDraftScope,
  now: Date,
  clientIp: string,
) {
  const { context, problemId } = scope;
  const activeExamSession = await examSessionRepo.findActiveForUser(actor.userId);
  if (
    activeExamSession &&
    actor.platformRole !== "admin" &&
    (context.type !== "exam" || context.examId !== activeExamSession.examId)
  ) {
    throw new ForbiddenError("You are in an active exam — use that exam context.");
  }

  switch (context.type) {
    case "exam": {
      if (activeExamSession?.examId !== context.examId) {
        throw new ForbiddenError("An active session for this exam is required.");
      }
      const gate = await checkProctoringGate({
        entityKind: "exam",
        entityId: context.examId,
        userId: actor.userId,
        ip: clientIp,
        now,
      });
      if (!gate.ok) throw new ForbiddenError(`Access blocked: exam ${gate.reason}.`);
      const exam = await examRepo.findById(context.examId);
      if (exam?.status !== "published") throw new NotFoundError("Exam not found.");
      if (now >= exam.endsAt) throw new ForbiddenError("Exam has ended.");
      if (!(await examProblemRepo.exists(exam.id, problemId))) {
        throw new ForbiddenError("This problem is not part of the exam.");
      }
      return;
    }
    case "assignment": {
      const [assessment, membership, course] = await Promise.all([
        assessmentRepo.findByIdWithCourseId(context.assessmentId),
        courseMembershipRepo.findByComposite(context.courseId, actor.userId),
        courseRepo.findById(context.courseId),
      ]);
      if (assessment?.courseId !== context.courseId || assessment.status !== "published") {
        throw new NotFoundError("Assignment not found.");
      }
      if (membership?.status !== "active") {
        throw new ForbiddenError("You are not enrolled in this course.");
      }
      if (course?.archived) {
        throw new ForbiddenError("This course is archived.");
      }
      if (
        actor.platformRole !== "admin" &&
        membership.role === "student" &&
        now < assessment.opensAt
      ) {
        throw new ForbiddenError("Assignment has not opened yet.");
      }
      if (!(await assessmentProblemRepo.exists(assessment.id, problemId))) {
        throw new ForbiddenError("This problem is not part of the assignment.");
      }
      return;
    }
    case "contest": {
      const contest = await contestRepo.findById(context.contestId);
      if (contest?.visibility !== "published") throw new NotFoundError("Contest not found.");
      if (now < contest.startsAt) throw new ForbiddenError("Contest has not started yet.");
      if (!(await contestProblemRepo.existsById(contest.id, problemId))) {
        throw new ForbiddenError("This problem is not part of the contest.");
      }
      return;
    }
    case "virtual":
      await assertCanSubmitToVirtualContest(
        context.participationId,
        actor.userId,
        problemId,
        now,
      );
      return;
    case "practice": {
      const problem = await problemRepo.findById(problemId);
      if (!problem) throw new NotFoundError("Problem not found.");
      await assertProblemViewAccess(problem, actor, { contextIncludesProblem: false });
      return;
    }
  }
}

export async function listCodeDrafts(
  actor: ActorContext,
  scope: CodeDraftScope,
  clientIp: string,
) {
  await assertProblemContextAllowed(actor, scope, new Date(), clientIp);
  const rows = await codeDraftRepo.listForProblem({
    userId: actor.userId,
    contextKey: codeDraftContextKey(scope.context),
    problemId: scope.problemId,
  });
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function saveCodeDraft(
  actor: ActorContext,
  draft: CodeDraftSave,
  clientIp: string,
) {
  await assertProblemContextAllowed(actor, draft, new Date(), clientIp);
  const saved = await codeDraftRepo.save(
    {
      userId: actor.userId,
      contextKey: codeDraftContextKey(draft.context),
      problemId: draft.problemId,
      language: draft.language,
    },
    draft.sourceFiles === undefined
      ? { sourceCode: draft.sourceCode ?? "" }
      : { sourceFiles: draft.sourceFiles },
  );
  return { updatedAt: saved.updatedAt.toISOString() };
}
