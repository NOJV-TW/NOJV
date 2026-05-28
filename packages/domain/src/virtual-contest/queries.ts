import { contestRepo, submissionRepo, virtualContestRepo } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema,
  type ContestScoringMode,
} from "@nojv/core";

import { problemLetter } from "../shared/problem-letter";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { getVerdictDetail } from "../submission/queries";
import { stripStaffFeedback } from "../submission/scoring";
import {
  buildScoreboard,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession,
} from "../scoring";
import { getScoreboard } from "../contest/scoring";

export type VirtualContestStatus = "active" | "finished";

export interface VirtualContestProblem {
  problemId: string;
  /** Contest-local letter (A, B, ...) derived from the problem's ordinal. */
  letter: string;
  ordinal: number;
  points: number;
  title: string;
  /** Best score this user has reached on the problem within the virtual run. */
  bestScore: number;
  solved: boolean;
}

export interface VirtualContestView {
  virtualContestId: string;
  contestId: string;
  contestTitle: string;
  scoringMode: ContestScoringMode;
  status: VirtualContestStatus;
  startedAt: string;
  endsAt: string;
  problems: VirtualContestProblem[];
}

export interface VirtualScoreboardRow {
  rank: number;
  username: string;
  displayName: string;
  totalScore: number;
  totalPenalty: number;
  /** True for the viewer's own (live, compute-on-read) row. */
  isMe: boolean;
  /** True for a static reference row copied from the original contest's final board. */
  isGhost: boolean;
}

export interface VirtualScoreboard {
  scoringMode: ContestScoringMode;
  rows: VirtualScoreboardRow[];
}

/** Time-derived status — v1 has no Temporal workflow, `now` is the source of truth. */
function statusFor(endsAt: Date, now: Date): VirtualContestStatus {
  return now < endsAt ? "active" : "finished";
}

/** Two scoreboard rows tie when both score and penalty match. */
function rowsTied(a: VirtualScoreboardRow, b: VirtualScoreboardRow): boolean {
  return a.totalScore === b.totalScore && a.totalPenalty === b.totalPenalty;
}

/**
 * Return the viewer's virtual-contest dashboard data, or `null` if they have
 * not started one for this contest. The problem list carries each problem's
 * best score within the virtual run so the dashboard can show solve state.
 */
// intentional-nullable: "not started" is a normal state — the dashboard route renders the start CTA instead of a 404.
export async function getVirtualContestForUser(
  contestId: string,
  userId: string,
  now: Date = new Date(),
): Promise<VirtualContestView | null> {
  const virtual = await virtualContestRepo.findByContestAndUser(contestId, userId);
  if (!virtual) return null;

  const contest = await contestRepo.findDetailById(contestId);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }

  const problemIds = contest.problems.map((cp) => cp.problem.id);

  // One grouped query — best score per problem scoped to this virtual run.
  const bestRows =
    problemIds.length === 0
      ? []
      : await submissionRepo.groupByUserAndProblem({
          userId,
          virtualContestId: virtual.id,
          problemId: { in: problemIds },
          sampleOnly: false,
          status: { in: [...submissionVerdicts] },
        });

  const bestByProblem = new Map<string, number>();
  for (const row of bestRows) {
    if (row._max.score !== null) bestByProblem.set(row.problemId, row._max.score);
  }

  const problems: VirtualContestProblem[] = contest.problems.map((cp) => {
    const bestScore = bestByProblem.get(cp.problem.id) ?? 0;
    return {
      problemId: cp.problem.id,
      letter: problemLetter(cp.ordinal),
      ordinal: cp.ordinal,
      points: cp.points,
      title: cp.problem.title,
      bestScore,
      solved: bestScore >= cp.points && cp.points > 0,
    };
  });

  return {
    virtualContestId: virtual.id,
    contestId: contest.id,
    contestTitle: contest.title,
    scoringMode: contest.scoringMode,
    status: statusFor(virtual.endsAt, now),
    startedAt: virtual.startedAt.toISOString(),
    endsAt: virtual.endsAt.toISOString(),
    problems,
  };
}

/**
 * Compute-on-read virtual scoreboard:
 *  - the viewer's own row is built live from submissions tagged with this
 *    `virtualContestId`, replaying `buildScoreboard` with `startsAt` swapped
 *    for the personal `startedAt` (so penalty times are measured against the
 *    user's own clock);
 *  - the original contest's final standings are appended as static "ghost"
 *    reference rows so the user can see where they would have placed.
 *
 * Returns `null` when the user has no virtual contest for this contest.
 */
// intentional-nullable: paired with getVirtualContestForUser — a user with no run gets the start CTA, not a 404.
export async function getVirtualContestScoreboard(
  contestId: string,
  userId: string,
): Promise<VirtualScoreboard | null> {
  const virtual = await virtualContestRepo.findByContestAndUser(contestId, userId);
  if (!virtual) return null;

  const contest = await contestRepo.findDetailById(contestId);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }

  const scoringMode = contest.scoringMode;
  const problems: ScoreboardProblem[] = contest.problems.map((cp) => ({
    id: cp.problem.id,
    ordinal: cp.ordinal,
    points: cp.points,
    title: cp.problem.title,
  }));

  // Original contest final board → ghost rows. The contest has ended, so the
  // user-facing scoreboard already reflects the final, unfrozen standings.
  const ghostBoard = await getScoreboard(contestId);
  const ghostRows: VirtualScoreboardRow[] = ghostBoard.entries.map((e) => ({
    rank: e.rank,
    username: e.username,
    displayName: e.displayName,
    totalScore: e.totalScore,
    totalPenalty: e.totalPenalty,
    isMe: false,
    isGhost: true,
  }));

  // Viewer's own live row from virtual-tagged submissions.
  const rawSubs = await submissionRepo.findForVirtualContestScoreboard(virtual.id);
  const submissions: SubmissionRow[] = rawSubs.map((s) => ({
    createdAt: s.createdAt,
    problemId: s.problemId,
    score: s.score,
    status: s.status,
    userId: s.userId,
  }));

  // The virtual run has exactly one participant — `startedAt` is the personal
  // session start so penalty is measured against the user's own clock.
  const participants: ParticipantRow[] = [
    {
      userId,
      user: {
        username: null,
        displayUsername: null,
        name: "you",
      },
    },
  ];
  const session: TimedSession = {
    id: virtual.id,
    startsAt: virtual.startedAt,
    endsAt: virtual.endsAt,
    frozenAt: null,
  };

  const myEntries: ScoreboardEntry[] = buildScoreboard(
    session,
    scoringMode,
    participants,
    submissions,
    problems,
    false,
  );
  const myEntry = myEntries[0];
  const myRow: VirtualScoreboardRow | null = myEntry
    ? {
        rank: myEntry.rank,
        username: myEntry.username,
        displayName: myEntry.displayName,
        totalScore: myEntry.totalScore,
        totalPenalty: myEntry.totalPenalty,
        isMe: true,
        isGhost: false,
      }
    : null;

  // Splice the user's row into the ghost ranking by score/penalty so the
  // dashboard shows their relative position. Lower penalty breaks score ties.
  const rows: VirtualScoreboardRow[] = myRow ? [...ghostRows, myRow] : ghostRows;
  rows.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.totalPenalty - b.totalPenalty;
  });
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const prev = i > 0 ? rows[i - 1] : undefined;
    row.rank = prev && rowsTied(prev, row) ? prev.rank : i + 1;
  }

  return { scoringMode, rows };
}

export interface VirtualSubmitGate {
  virtualContestId: string;
  contestId: string;
}

/**
 * Submission gate for virtual-contest mode. Given a `virtualContestId` from
 * the submission draft, confirms:
 *  - the row exists and belongs to `userId`;
 *  - the personal timer is still running (`now < endsAt`);
 *  - `problemId` belongs to the original contest the run replays.
 *
 * Throws `NotFoundError` / `ForbiddenError` otherwise. Called inside the
 * submission transaction, mirroring how `ensureContestParticipation` gates
 * real-contest submissions.
 */
export async function assertCanSubmitToVirtualContest(
  virtualContestId: string,
  userId: string,
  problemId: string,
  now: Date = new Date(),
): Promise<VirtualSubmitGate> {
  const virtual = await virtualContestRepo.findById(virtualContestId);
  if (virtual?.userId !== userId) {
    throw new NotFoundError("Virtual contest not found.");
  }
  if (now >= virtual.endsAt) {
    throw new ForbiddenError("Your virtual contest timer has ended.");
  }

  const contest = await contestRepo.findDetailById(virtual.contestId);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${virtual.contestId}`);
  }
  const belongs = contest.problems.some((cp) => cp.problem.id === problemId);
  if (!belongs) {
    throw new ForbiddenError("This problem is not part of the contest.");
  }

  return { virtualContestId: virtual.id, contestId: virtual.contestId };
}

export interface VirtualSubmissionEntry {
  id: string;
  language: ReturnType<typeof languageSchema.parse>;
  result: ReturnType<typeof submissionResultSchema.parse>;
  submittedAt: string;
}

/**
 * The viewer's submission history for one problem, scoped to a virtual run.
 * Mirrors `submissionDomain.listProblemSubmissions` but filters by
 * `virtualContestId` so the solve page only shows the personal re-run's
 * attempts — not the user's live-contest or practice submissions.
 */
export async function listVirtualContestProblemSubmissions(
  virtualContestId: string,
  userId: string,
  problemId: string,
): Promise<VirtualSubmissionEntry[]> {
  const submissions = await submissionRepo.listByUserAndProblem({
    problemId,
    userId,
    statusIn: [...submissionVerdicts],
    virtualContestId,
  });

  // Verdict detail lives in object storage; pull each row's blob in parallel.
  const detailBlobs = await Promise.all(
    submissions.map((s) =>
      s.verdictDetailStorageKey ? getVerdictDetail(s.id) : Promise.resolve(null),
    ),
  );

  return submissions.map((s, idx) => {
    submissionVerdictSchema.parse(s.status);
    // Personal virtual run — viewer is always the submitter, never a staff viewer.
    const result = stripStaffFeedback(submissionResultSchema.parse(detailBlobs[idx]));
    const language = languageSchema.parse(s.language);
    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString(),
    };
  });
}
