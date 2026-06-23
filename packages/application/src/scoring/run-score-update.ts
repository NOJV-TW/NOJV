import type { ContestScoringMode } from "@nojv/core";

import { ConflictError } from "../shared/errors";
import { computeBestScoreState, computeProblemCountState } from "./persist-core";

const SCORE_UPDATE_MAX_ATTEMPTS = 3;

interface ScoredSubmission {
  problemId: string;
  score: number;
  status: string;
  createdAt: Date;
}

interface OverrideRow {
  userId: string;
  problemId: string;
  overrideScore: number;
}

interface PersistFields {
  score: number;
  subtaskScores?: Record<string, number>;
  penaltySeconds?: number;
}

export interface ScoringUpdate<P> {
  load(): Promise<P | null>;
  submissions(participation: P): Promise<readonly ScoredSubmission[]>;
  overrides(participation: P): Promise<readonly OverrideRow[]>;
  problemIds(participation: P): ReadonlySet<string>;
  problemPoints(participation: P): ReadonlyMap<string, number>;
  scoringMode(participation: P): ContestScoringMode;
  startsAt(participation: P): Date;
  penaltyPerWrongSec?(participation: P): number;
  userId(participation: P): string;
  persist(participation: P, fields: PersistFields): Promise<unknown>;
  isConflict(err: unknown): boolean;
}

export async function runScoreUpdate<P>(
  participationId: string,
  adapter: ScoringUpdate<P>,
): Promise<P | null> {
  let overrides: readonly OverrideRow[] | undefined;

  for (let attempt = 1; attempt <= SCORE_UPDATE_MAX_ATTEMPTS; attempt++) {
    const participation = await adapter.load();
    if (!participation) return null;

    const submissions = await adapter.submissions(participation);
    const problemIds = adapter.problemIds(participation);

    try {
      if (adapter.scoringMode(participation) === "problem_count") {
        const { score, penaltySeconds } = computeProblemCountState({
          submissions,
          problemIds,
          problemPoints: adapter.problemPoints(participation),
          startsAt: adapter.startsAt(participation),
          ...(adapter.penaltyPerWrongSec
            ? { penaltyPerWrongSec: adapter.penaltyPerWrongSec(participation) }
            : {}),
        });
        await adapter.persist(participation, { score, penaltySeconds });
      } else {
        overrides ??= await adapter.overrides(participation);
        const { totalScore, subtaskScores } = computeBestScoreState({
          submissions,
          problemIds,
          overrides,
          userId: adapter.userId(participation),
        });
        await adapter.persist(participation, { score: totalScore, subtaskScores });
      }
      return participation;
    } catch (err) {
      if (adapter.isConflict(err)) continue;
      throw err;
    }
  }

  throw new ConflictError(
    `Could not persist score for participation ${participationId} after ${String(SCORE_UPDATE_MAX_ATTEMPTS)} attempts.`,
  );
}
