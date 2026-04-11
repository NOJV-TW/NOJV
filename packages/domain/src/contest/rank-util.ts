export interface ProblemScore {
  problemId: string;
  score: number;
  attempts: number;
  firstAcTime: number | null;
  isFrozen: boolean;
  isPending: boolean;
}

export interface ScoreboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  totalScore: number;
  totalPenalty: number;
  problems: ProblemScore[];
  isFirstBlood: boolean[];
}

export interface ScoreboardProblem {
  id: string;
  title: string;
  ordinal: number;
  points: number;
}

export interface ContestRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  scoringMode: string;
  scoreboardMode: string;
  frozenAt: Date | null;
  frozenBoard: boolean;
  problems: {
    problemId: string;
    ordinal: number;
    points: number;
    problem: { id: string; title: string };
  }[];
}

export interface SubmissionRow {
  createdAt: Date;
  problemId: string;
  score: number;
  status: string;
  userId: string;
}

export interface ParticipantRow {
  userId: string;
  user: { username: string | null; displayUsername: string | null; name: string };
}

export function secondsSince(base: Date, later: Date): number {
  return Math.max(0, Math.floor((later.getTime() - base.getTime()) / 1000));
}

export function groupByUser(submissions: SubmissionRow[]): Map<string, SubmissionRow[]> {
  const byUser = new Map<string, SubmissionRow[]>();
  for (const sub of submissions) {
    const existing = byUser.get(sub.userId);
    if (existing) {
      existing.push(sub);
    } else {
      byUser.set(sub.userId, [sub]);
    }
  }
  return byUser;
}

export function resolveDisplayUsername(user: ParticipantRow["user"]): string {
  return user.displayUsername ?? user.username ?? user.name;
}

/**
 * Assigns dense ranks to a pre-sorted scoreboard. Entries that the `isTied`
 * predicate considers equal to the previous entry share the previous entry's
 * rank; otherwise they get `index + 1`.
 */
export function assignRanks(
  entries: ScoreboardEntry[],
  isTied: (a: ScoreboardEntry, b: ScoreboardEntry) => boolean
): void {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const prev = i > 0 ? entries[i - 1] : undefined;
    entry.rank = prev && isTied(prev, entry) ? prev.rank : i + 1;
  }
}
