import {
  assessmentRepo,
  contestRepo,
  examRepo,
  plagiarismPairFlagRepo,
  type PlagiarismContext,
  type PlagiarismPairFlagRow,
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";
import { isCourseStaff } from "../shared/permissions";

export type { PlagiarismContext };

export function buildPairKey(userAId: string, userBId: string, problemId: string): string {
  if (!userAId || !userBId || !problemId) {
    throw new ValidationError("userAId, userBId, and problemId are required.");
  }
  if (userAId === userBId) {
    throw new ValidationError("A pair cannot consist of the same user twice.");
  }
  const sorted: [string, string] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
  return `${sorted[0]}|${sorted[1]}|${problemId}`;
}

async function canManagePlagiarismFlag(
  actor: ActorContext,
  contextType: PlagiarismContext,
  contextId: string,
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  switch (contextType) {
    case "assessment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(contextId);
      if (!assignment) return false;
      return isCourseStaff(actor.userId, assignment.courseId);
    }
    case "exam": {
      const exam = await examRepo.findById(contextId);
      if (!exam) return false;
      return isCourseStaff(actor.userId, exam.courseId);
    }
    case "contest": {
      const contest = await contestRepo.findById(contextId);
      return contest?.createdByUserId === actor.userId;
    }
  }
}

async function assertCanManagePlagiarismFlag(
  actor: ActorContext,
  contextType: PlagiarismContext,
  contextId: string,
): Promise<void> {
  if (!(await canManagePlagiarismFlag(actor, contextType, contextId))) {
    throw new ForbiddenError("Not permitted to manage plagiarism flags for this context.");
  }
}

export interface FlagPairInput {
  contextType: PlagiarismContext;
  contextId: string;
  pairKey: string;
  note?: string | null;
}

export async function flagPair(
  actor: ActorContext,
  input: FlagPairInput,
): Promise<PlagiarismPairFlagRow> {
  await assertCanManagePlagiarismFlag(actor, input.contextType, input.contextId);

  return plagiarismPairFlagRepo.upsert({
    contextType: input.contextType,
    contextId: input.contextId,
    pairKey: input.pairKey,
    flaggedBy: actor.userId,
    note: input.note ?? null,
  });
}

export async function unflagPair(actor: ActorContext, flagId: string): Promise<void> {
  const flag = await plagiarismPairFlagRepo.findById(flagId);
  if (!flag) {
    throw new NotFoundError("Plagiarism flag not found.");
  }

  await assertCanManagePlagiarismFlag(actor, flag.contextType, flag.contextId);
  await plagiarismPairFlagRepo.deleteById(flagId);
}

export function listFlagsForContext(
  contextType: PlagiarismContext,
  contextId: string,
): Promise<PlagiarismPairFlagRow[]> {
  return plagiarismPairFlagRepo.listByContext(contextType, contextId);
}
