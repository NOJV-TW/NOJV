import { contestRepo, participationRepo, submissionRepo } from "@nojv/db";
import type { languageSchema } from "@nojv/core";
import {
  problemLetter,
  submissionVerdicts,
  verdictSummarySchema,
  type ContestScoringMode,
  type submissionResultSchema,
  type SubmissionResult,
} from "@nojv/core";

import { ForbiddenError, NotFoundError } from "../shared/errors";
import { narrowSubmissionRow } from "../submission/queries";
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
  participationId: string;
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

// intentional-nullable: caller needs absence when no virtual session exists.
export async function getVirtualContestForUser(
  contestId: string,
  userId: string,
  now: Date = new Date(),
): Promise<VirtualContestView | null> {
  const virtual = await participationRepo.findVirtual(contestId, userId);
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
          participationId: virtual.id,
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
    participationId: virtual.id,
    contestId: contest.id,
    contestTitle: contest.title,
    scoringMode: contest.scoringMode,
    status: statusFor(virtual.endsAt, now),
    startedAt: virtual.startedAt.toISOString(),
    endsAt: virtual.endsAt.toISOString(),
    problems,
  };
}

// intentional-nullable: caller needs absence when no virtual session exists.
export async function getVirtualContestScoreboard(
  contestId: string,
  userId: string,
): Promise<VirtualScoreboard | null> {
  const virtual = await participationRepo.findVirtual(contestId, userId);
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
  participationId: string;
  contestId: string;
}

export async function assertCanSubmitToVirtualContest(
  participationId: string,
  userId: string,
  problemId: string,
  now: Date = new Date(),
): Promise<VirtualSubmitGate> {
  const virtual = await participationRepo.findVirtualById(participationId);
  if (virtual?.userId !== userId || virtual.contestId === null) {
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

  return { participationId: virtual.id, contestId: virtual.contestId };
}

export interface VirtualSubmissionEntry {
  id: string;
  language: ReturnType<typeof languageSchema.parse>;
  result: ReturnType<typeof submissionResultSchema.parse>;
  submittedAt: string;
}

export async function listVirtualContestProblemSubmissions(
  participationId: string,
  userId: string,
  problemId: string,
): Promise<VirtualSubmissionEntry[]> {
  const submissions = await submissionRepo.listByUserAndProblem({
    problemId,
    userId,
    statusIn: [...submissionVerdicts],
    participationId,
  });

  return submissions.map((s) => {
    const { verdict, language } = narrowSubmissionRow(s);
    const parsedSummary =
      s.verdictSummary == null ? null : verdictSummarySchema.safeParse(s.verdictSummary);
    const summary = parsedSummary?.success ? parsedSummary.data : null;
    const result: SubmissionResult = {
      accepted: verdict === "accepted",
      verdict,
      score: s.score,
      runtimeMs: s.runtimeMs ?? 0,
      feedback:
        summary?.compilerErrorTruncated ??
        (verdict === "accepted" ? "Accepted." : "Verdict details unavailable."),
    };
    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString(),
    };
  });
}
