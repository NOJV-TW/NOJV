import { contestRepo, participationRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";

export type { ActorContext };

export async function startVirtualContest(
  actor: ActorContext,
  contestId: string,
  now: Date = new Date(),
) {
  const existing = await participationRepo.findVirtual(contestId, actor.userId);
  if (existing) return existing;

  const contest = await contestRepo.findById(contestId);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }
  if (now < contest.endsAt) {
    throw new ForbiddenError("A virtual contest can only be started after the contest ends.");
  }

  const durationMs = contest.endsAt.getTime() - contest.startsAt.getTime();
  const startedAt = now;
  const endsAt = new Date(startedAt.getTime() + durationMs);

  try {
    return await participationRepo.createVirtual({
      contestId,
      userId: actor.userId,
      startedAt,
      endsAt,
    });
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "P2002") {
      const row = await participationRepo.findVirtual(contestId, actor.userId);
      if (row) return row;
    }
    throw err;
  }
}
