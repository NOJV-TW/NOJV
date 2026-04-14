/**
 * Entity-agnostic types and helpers shared by ICPC and IOI scoreboard
 * builders. No contest/exam vocabulary lives here — both consumers pass in
 * a neutral `TimedSession` shape (see `./icpc.ts` and `./ioi.ts`).
 */

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

/**
 * Neutral "timed session" shape that both Contest and Exam satisfy. The
 * scoreboard builders only need these three fields — anything else is
 * orchestration-layer concern.
 */
export interface TimedSession {
  id: string;
  startsAt: Date;
  endsAt: Date;
  frozenAt: Date | null;
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

/**
 * Splits a user's submissions for one problem into the portion visible on the
 * scoreboard and derives whether the cell is frozen. ICPC and IOI scoring
 * share this rule exactly: when `showFrozen` is active and a freeze time is
 * set, hide anything submitted after the freeze; the cell is "frozen" when
 * the user has at least one post-freeze submission.
 */
export function splitFrozenVisible(
  probSubs: SubmissionRow[],
  frozenAt: Date | null,
  showFrozen: boolean
): { visibleSubs: SubmissionRow[]; isFrozen: boolean } {
  if (!(showFrozen && frozenAt)) {
    return { isFrozen: false, visibleSubs: probSubs };
  }
  const visibleSubs: SubmissionRow[] = [];
  let hasFrozen = false;
  for (const s of probSubs) {
    if (s.createdAt > frozenAt) {
      hasFrozen = true;
    } else {
      visibleSubs.push(s);
    }
  }
  return { isFrozen: hasFrozen, visibleSubs };
}

/**
 * Shared scoreboard comparator: higher `totalScore` first, ties broken by
 * lower `totalPenalty`. ICPC uses seconds-of-penalty; IOI reuses the slot as
 * `lastImprovementTime`. The ordering rule is identical.
 */
export function sortByScoreThenPenalty(entries: ScoreboardEntry[]): void {
  entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.totalPenalty - b.totalPenalty;
  });
}
