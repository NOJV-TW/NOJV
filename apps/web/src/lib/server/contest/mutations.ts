import type { TransactionClient } from "@nojv/db";

import { ForbiddenError, NotFoundError } from "../auth";

export async function requireContest(tx: TransactionClient, contestSlug: string) {
  const contest = await tx.contest.findUnique({
    where: { slug: contestSlug }
  });

  if (!contest) {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  return contest;
}

export async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestSlug: string
) {
  const contest = await requireContest(tx, contestSlug);

  if (contest.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  const now = new Date();
  if (now < contest.startsAt) {
    throw new ForbiddenError("Contest has not started yet.");
  }
  if (now > contest.endsAt) {
    throw new ForbiddenError("Contest has ended.");
  }

  return tx.contestParticipation.upsert({
    create: {
      contestId: contest.id,
      startedAt: new Date(),
      status: "active",
      userId
    },
    update: {
      status: "active"
    },
    where: {
      contestId_userId: {
        contestId: contest.id,
        userId
      }
    }
  });
}
