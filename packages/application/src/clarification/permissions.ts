import {
  assessmentRepo,
  contestRepo,
  courseMembershipRepo,
  examRepo,
  participationRepo,
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError } from "../shared/errors";
import { isCourseStaff } from "../shared/permissions";
import type { ClarificationContext } from "./types";

async function hasContestParticipation(userId: string, contestId: string): Promise<boolean> {
  const ids = await participationRepo.listContestParticipantUserIds(contestId);
  return ids.includes(userId);
}

async function hasExamParticipation(userId: string, examId: string): Promise<boolean> {
  const ids = await participationRepo.listExamParticipantUserIds(examId);
  return ids.includes(userId);
}

async function isActiveStudentInAssignment(
  userId: string,
  assignmentId: string,
): Promise<boolean> {
  const assignment = await assessmentRepo.findByIdWithCourseId(assignmentId);
  if (!assignment) return false;
  const membership = await courseMembershipRepo.findByComposite(assignment.courseId, userId);
  if (membership?.status !== "active") return false;
  return membership.role === "student";
}

async function isParticipantOfContext(
  actor: ActorContext,
  context: ClarificationContext,
): Promise<boolean> {
  if (actor.platformRole === "admin") return false;
  switch (context.type) {
    case "contest":
      return hasContestParticipation(actor.userId, context.contestId);
    case "exam":
      return hasExamParticipation(actor.userId, context.examId);
    case "assignment":
      return isActiveStudentInAssignment(actor.userId, context.assignmentId);
  }
}

async function isStaffOfContext(
  actor: ActorContext,
  context: ClarificationContext,
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;
  switch (context.type) {
    case "contest": {
      const contest = await contestRepo.findById(context.contestId);
      return contest?.createdByUserId === actor.userId;
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) return false;
      return isCourseStaff(actor.userId, exam.courseId);
    }
    case "assignment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assignment) return false;
      return isCourseStaff(actor.userId, assignment.courseId);
    }
  }
}

async function isContextWindowOpen(context: ClarificationContext): Promise<boolean> {
  const now = new Date();
  switch (context.type) {
    case "contest": {
      const contest = await contestRepo.findById(context.contestId);
      if (!contest) return false;
      return now >= contest.startsAt && now <= contest.endsAt;
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) return false;
      return now >= exam.startsAt && now <= exam.endsAt;
    }
    case "assignment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assignment) return false;
      return now >= assignment.opensAt && now <= assignment.closesAt;
    }
  }
}

export async function canAskClarification(
  actor: ActorContext,
  context: ClarificationContext,
): Promise<boolean> {
  if (!(await isParticipantOfContext(actor, context))) return false;
  return isContextWindowOpen(context);
}

export async function canAnswerInContext(
  actor: ActorContext,
  context: ClarificationContext,
): Promise<boolean> {
  if (!(await isStaffOfContext(actor, context))) return false;
  return isContextWindowOpen(context);
}

export async function canViewClarifications(
  actor: ActorContext,
  context: ClarificationContext,
): Promise<boolean> {
  if (await isStaffOfContext(actor, context)) return true;
  return isParticipantOfContext(actor, context);
}

export const canSeeAuthor = isStaffOfContext;

export async function assertCanViewClarifications(
  actor: ActorContext,
  context: ClarificationContext,
): Promise<void> {
  if (!(await canViewClarifications(actor, context))) {
    throw new ForbiddenError("Not permitted to view clarifications in this context.");
  }
}
