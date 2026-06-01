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
import { fallbackResultForRow, getVerdictDetail } from "../submission/queries";
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
  letter: string;
  ordinal: number;
  points: number;
  title: string;
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
  isMe: boolean;
  isGhost: boolean;
}

export interface VirtualScoreboard {
  scoringMode: ContestScoringMode;
  rows: VirtualScoreboardRow[];
}

function statusFor(endsAt: Date, now: Date): VirtualContestStatus {
  return now < endsAt ? "active" : "finished";
}

function rowsTied(a: VirtualScoreboardRow, b: VirtualScoreboardRow): boolean {
  return a.totalScore === b.totalScore && a.totalPenalty === b.totalPenalty;
}

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

  const rawSubs = await submissionRepo.findForVirtualContestScoreboard(virtual.id);
  const submissions: SubmissionRow[] = rawSubs.map((s) => ({
    createdAt: s.createdAt,
    problemId: s.problemId,
    score: s.score,
    status: s.status,
    userId: s.userId,
  }));

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

  const detailBlobs = await Promise.all(
    submissions.map((s) =>
      s.verdictDetailStorageKey ? getVerdictDetail(s.id) : Promise.resolve(null),
    ),
  );

  return submissions.map((s, idx) => {
    const verdict = submissionVerdictSchema.parse(s.status);
    const raw = detailBlobs[idx];
    const parsed = raw == null ? null : submissionResultSchema.safeParse(raw);
    const result = parsed?.success
      ? stripStaffFeedback(parsed.data)
      : fallbackResultForRow(verdict);
    const language = languageSchema.parse(s.language);
    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString(),
    };
  });
}
