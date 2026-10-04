import { assessmentRepo, courseRepo, examRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { assertContextClosed, isContextClosed } from "../shared/context-window";
import { ForbiddenError } from "../shared/errors";
import { isCourseStaff } from "../shared/permissions";
import type { ScoreOverrideContext } from "./types";

async function contextCourseId(context: ScoreOverrideContext): Promise<string | null> {
  switch (context.type) {
    case "assignment":
      return (
        (await assessmentRepo.findByIdWithCourseId(context.assignmentId))?.courseId ?? null
      );
    case "exam":
      return (await examRepo.findById(context.examId))?.courseId ?? null;
  }
}

export async function canViewScoreOverrides(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;
  const courseId = await contextCourseId(context);
  return courseId !== null && isCourseStaff(actor.userId, courseId);
}

export async function canSetScoreOverride(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<boolean> {
  const courseId = await contextCourseId(context);
  if (courseId === null) return false;
  const course = await courseRepo.findById(courseId);
  if (!course || course.archived) return false;
  if (actor.platformRole === "admin") return true;
  if (!(await isCourseStaff(actor.userId, courseId))) return false;
  return isContextClosed(context);
}

export async function assertCanViewScoreOverrides(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<void> {
  if (!(await canViewScoreOverrides(actor, context))) {
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
