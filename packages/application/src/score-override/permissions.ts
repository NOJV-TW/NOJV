import { assessmentRepo, contestRepo, examRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { assertContextClosed } from "../shared/context-window";
import { ForbiddenError } from "../shared/errors";
import { isCourseStaff } from "../shared/permissions";
import type { ScoreOverrideContext } from "./types";

export async function canSetScoreOverride(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  switch (context.type) {
    case "contest": {
      const contest = await contestRepo.findById(context.contestId);
      return contest?.createdByUserId === actor.userId;
    }
    case "assignment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assignment) return false;
      return isCourseStaff(actor.userId, assignment.courseId);
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) return false;
      return isCourseStaff(actor.userId, exam.courseId);
    }
  }
}

export async function assertCanViewScoreOverrides(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<void> {
  if (!(await canSetScoreOverride(actor, context))) {
    throw new ForbiddenError("Not permitted to view score overrides for this context.");
  }
}

export async function assertCanSetScoreOverride(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<void> {
  await assertCanViewScoreOverrides(actor, context);
  if (actor.platformRole !== "admin") {
    await assertContextClosed(context);
  }
}
