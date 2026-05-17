import { contestRepo, virtualContestRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";

export type { ActorContext };

/**
 * Start (or resume) a personal virtual run of a past contest.
 *
 * v1 design (locked):
 *  - Only published contests that have already ended can be virtualised.
 *  - The personal timer length equals the original contest's duration
 *    (`endsAt - startsAt`); `VirtualContest.endsAt = startedAt + duration`.
 *  - At most one VirtualContest per (contest, user) — the schema unique
 *    guarantees this, and this function is idempotent: if a row already
 *    exists it is returned unchanged (timer keeps running on its own clock).
 *
 * The `score / penaltySeconds / subtaskScores / version` columns are left at
 * their defaults — v1 scoring is compute-on-read (see `queries.ts`); those
 * columns are reserved for a future live-virtual-scoreboard iteration.
 */
export async function startVirtualContest(
  actor: ActorContext,
  contestId: string,
  now: Date = new Date(),
) {
  const existing = await virtualContestRepo.findByContestAndUser(contestId, actor.userId);
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
    return await virtualContestRepo.create({
      contestId,
      userId: actor.userId,
      startedAt,
      endsAt,
    });
  } catch (err) {
    // A concurrent start raced us — the @@unique([contestId, userId])
    // surfaces as P2002. Fall back to the row the other writer created.
    if (err instanceof Error && (err as { code?: string }).code === "P2002") {
      const row = await virtualContestRepo.findByContestAndUser(contestId, actor.userId);
      if (row) return row;
    }
    throw err;
  }
}
