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

// Cell is "frozen" when the user has at least one post-freeze submission and `showFrozen` is active.
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

// IOI reuses `totalPenalty` as `lastImprovementTime` — both sort order rules are identical.
export function sortByScoreThenPenalty(entries: ScoreboardEntry[]): void {
  entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.totalPenalty - b.totalPenalty;
  });
}
