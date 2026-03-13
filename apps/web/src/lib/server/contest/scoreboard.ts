import { prisma } from "@nojv/db";
import type { ContestScoringMode } from "@nojv/core";

import { NotFoundError } from "../auth";

// ─── Types ───────────────────────────────────────────────────────────

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
  handle: string;
  displayName: string;
  totalScore: number;
  totalPenalty: number;
  problems: ProblemScore[];
  isFirstBlood: boolean[];
}

export interface ScoreboardProblem {
  id: string;
  slug: string;
  title: string;
  ordinal: number;
  points: number;
}

export interface ScoreboardData {
  entries: ScoreboardEntry[];
  problems: ScoreboardProblem[];
  scoringMode: ContestScoringMode;
  frozenAt: string | null;
  isFrozen: boolean;
}

export interface ChartData {
  series: {
    userId: string;
    handle: string;
    points: { time: number; score: number }[];
  }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface ContestRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  scoringMode: string;
  frozenAt: Date | null;
  frozenBoard: boolean;
  problems: {
    problemId: string;
    ordinal: number;
    points: number;
    problem: { slug: string; defaultTitle: string };
  }[];
}

interface SubmissionRow {
  createdAt: Date;
  problemId: string;
  score: number;
  status: string;
  userId: string;
}

interface ParticipantRow {
  userId: string;
  user: { handle: string | null; displayHandle: string | null; name: string };
}

function secondsSince(base: Date, later: Date): number {
  return Math.max(0, Math.floor((later.getTime() - base.getTime()) / 1000));
}

// ─── Scoreboard ──────────────────────────────────────────────────────

export async function getScoreboard(
  contestSlug: string,
  options?: { unfrozen?: boolean }
): Promise<ScoreboardData> {
  const contest = await prisma.contest.findUnique({
    include: {
      problems: {
        include: { problem: { select: { defaultTitle: true, slug: true } } },
        orderBy: { ordinal: "asc" }
      },
      participations: {
        include: {
          user: { select: { displayHandle: true, handle: true, name: true } }
        },
        where: { status: { in: ["active", "submitted"] } }
      }
    },
    where: { slug: contestSlug }
  });

  if (!contest || contest.visibility === "draft") {
    throw new NotFoundError("Contest not found.");
  }

  const now = new Date();
  const showFrozen =
    !options?.unfrozen &&
    contest.frozenBoard &&
    contest.frozenAt != null &&
    now > contest.frozenAt;

  const problems: ScoreboardProblem[] = contest.problems.map((cp) => ({
    id: cp.problemId,
    ordinal: cp.ordinal,
    points: cp.points,
    slug: cp.problem.slug,
    title: cp.problem.defaultTitle
  }));

  if (contest.participations.length === 0) {
    return {
      entries: [],
      frozenAt: contest.frozenAt?.toISOString() ?? null,
      isFrozen: showFrozen,
      problems,
      scoringMode: contest.scoringMode as ContestScoringMode
    };
  }

  // Fetch all non-sample submissions for this contest
  const participationIds = contest.participations.map((p) => p.id);
  const allSubmissions = await prisma.submission.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      contestParticipation: { select: { userId: true } },
      createdAt: true,
      problemId: true,
      score: true,
      status: true
    },
    where: {
      contestParticipationId: { in: participationIds },
      sampleOnly: false
    }
  });

  const submissions: SubmissionRow[] = allSubmissions.map((s) => ({
    createdAt: s.createdAt,
    problemId: s.problemId,
    score: s.score,
    status: s.status,
    userId: s.contestParticipation!.userId
  }));

  const participants: ParticipantRow[] = contest.participations;

  const scoringMode = contest.scoringMode as ContestScoringMode;

  const entries =
    scoringMode === "icpc"
      ? buildIcpcScoreboard(contest, participants, submissions, problems, showFrozen)
      : buildIoiScoreboard(contest, participants, submissions, problems, showFrozen);

  return {
    entries,
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    isFrozen: showFrozen,
    problems,
    scoringMode
  };
}

// ─── ICPC Scoreboard ─────────────────────────────────────────────────

function buildIcpcScoreboard(
  contest: ContestRow,
  participants: ParticipantRow[],
  submissions: SubmissionRow[],
  problems: ScoreboardProblem[],
  showFrozen: boolean
): ScoreboardEntry[] {
  const problemIds = problems.map((p) => p.id);
  const frozenAt = contest.frozenAt;

  // Track first AC per problem (global, unfrozen)
  const firstAcByProblem = new Map<string, string>(); // problemId -> userId

  // Group submissions by userId
  const subsByUser = new Map<string, SubmissionRow[]>();
  for (const sub of submissions) {
    const existing = subsByUser.get(sub.userId) ?? [];
    existing.push(sub);
    subsByUser.set(sub.userId, existing);
  }

  // First pass: find global first AC per problem (ignoring frozen)
  for (const problemId of problemIds) {
    for (const sub of submissions) {
      if (sub.problemId === problemId && sub.status === "accepted") {
        firstAcByProblem.set(problemId, sub.userId);
        break;
      }
    }
  }

  const entries: ScoreboardEntry[] = participants.map((p) => {
    const userSubs = subsByUser.get(p.userId) ?? [];
    let totalScore = 0;
    let totalPenalty = 0;
    const problemScores: ProblemScore[] = [];
    const isFirstBlood: boolean[] = [];

    for (const prob of problems) {
      const probSubs = userSubs.filter((s) => s.problemId === prob.id);
      const frozenSubs = frozenAt ? probSubs.filter((s) => s.createdAt > frozenAt) : [];
      const visibleSubs =
        showFrozen && frozenAt ? probSubs.filter((s) => s.createdAt <= frozenAt) : probSubs;

      let score = 0;
      let attempts = 0;
      let firstAcTime: number | null = null;
      const isFrozen = showFrozen && frozenSubs.length > 0;
      const isPending = isFrozen;

      for (const sub of visibleSubs) {
        if (sub.status === "accepted") {
          score = prob.points;
          firstAcTime = secondsSince(contest.startsAt, sub.createdAt);
          totalScore += prob.points;
          totalPenalty += firstAcTime + attempts * 20 * 60;
          break;
        }
        attempts++;
      }

      problemScores.push({
        attempts,
        firstAcTime,
        isFrozen,
        isPending,
        problemId: prob.id,
        score
      });

      isFirstBlood.push(firstAcByProblem.get(prob.id) === p.userId && firstAcTime != null);
    }

    return {
      displayName: p.user.name,
      handle: p.user.displayHandle ?? p.user.handle ?? p.user.name,
      isFirstBlood,
      problems: problemScores,
      rank: 0,
      totalPenalty,
      totalScore,
      userId: p.userId
    };
  });

  // Sort: totalScore DESC, totalPenalty ASC
  entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.totalPenalty - b.totalPenalty;
  });

  // Assign ranks (same score+penalty = same rank)
  let rank = 1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const prev = i > 0 ? entries[i - 1]! : null;
    if (
      prev &&
      entry.totalScore === prev.totalScore &&
      entry.totalPenalty === prev.totalPenalty
    ) {
      entry.rank = prev.rank;
    } else {
      entry.rank = rank;
    }
    rank = i + 2;
  }

  return entries;
}

// ─── IOI Scoreboard ──────────────────────────────────────────────────

function buildIoiScoreboard(
  contest: ContestRow,
  participants: ParticipantRow[],
  submissions: SubmissionRow[],
  problems: ScoreboardProblem[],
  showFrozen: boolean
): ScoreboardEntry[] {
  const frozenAt = contest.frozenAt;

  // Track first full-score per problem (global)
  const firstFullByProblem = new Map<string, string>();

  // Group submissions by userId
  const subsByUser = new Map<string, SubmissionRow[]>();
  for (const sub of submissions) {
    const existing = subsByUser.get(sub.userId) ?? [];
    existing.push(sub);
    subsByUser.set(sub.userId, existing);
  }

  // First pass: find global first full-score per problem
  for (const prob of problems) {
    for (const sub of submissions) {
      if (sub.problemId === prob.id && sub.score >= prob.points) {
        firstFullByProblem.set(prob.id, sub.userId);
        break;
      }
    }
  }

  const entries: ScoreboardEntry[] = participants.map((p) => {
    const userSubs = subsByUser.get(p.userId) ?? [];
    let totalScore = 0;
    let lastImprovementTime = 0;
    const problemScores: ProblemScore[] = [];
    const isFirstBlood: boolean[] = [];

    for (const prob of problems) {
      const probSubs = userSubs.filter((s) => s.problemId === prob.id);
      const frozenSubs = frozenAt ? probSubs.filter((s) => s.createdAt > frozenAt) : [];
      const visibleSubs =
        showFrozen && frozenAt ? probSubs.filter((s) => s.createdAt <= frozenAt) : probSubs;

      const isFrozen = showFrozen && frozenSubs.length > 0;
      const isPending = isFrozen;

      let bestScore = 0;
      let firstAcTime: number | null = null;

      for (const sub of visibleSubs) {
        if (sub.score > bestScore) {
          bestScore = sub.score;
          const subTime = secondsSince(contest.startsAt, sub.createdAt);
          if (subTime > lastImprovementTime) {
            lastImprovementTime = subTime;
          }
        }
        if (sub.score >= prob.points && firstAcTime == null) {
          firstAcTime = secondsSince(contest.startsAt, sub.createdAt);
        }
      }

      totalScore += bestScore;

      problemScores.push({
        attempts: visibleSubs.length,
        firstAcTime,
        isFrozen,
        isPending,
        problemId: prob.id,
        score: bestScore
      });

      isFirstBlood.push(firstFullByProblem.get(prob.id) === p.userId && firstAcTime != null);
    }

    return {
      displayName: p.user.name,
      handle: p.user.displayHandle ?? p.user.handle ?? p.user.name,
      isFirstBlood,
      problems: problemScores,
      rank: 0,
      totalPenalty: lastImprovementTime,
      totalScore,
      userId: p.userId
    };
  });

  // Sort: totalScore DESC, lastImprovementTime ASC
  entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.totalPenalty - b.totalPenalty;
  });

  // Assign ranks
  let rank = 1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const prev = i > 0 ? entries[i - 1]! : null;
    if (prev && entry.totalScore === prev.totalScore) {
      entry.rank = prev.rank;
    } else {
      entry.rank = rank;
    }
    rank = i + 2;
  }

  return entries;
}

// ─── Chart ───────────────────────────────────────────────────────────

export async function getScoreboardChart(
  contestSlug: string,
  topN: number
): Promise<ChartData> {
  // Get the scoreboard to determine top N
  const scoreboard = await getScoreboard(contestSlug, { unfrozen: false });

  const topEntries = scoreboard.entries.slice(0, topN);
  if (topEntries.length === 0) {
    return { series: [] };
  }

  const topUserIds = new Set(topEntries.map((e) => e.userId));

  // Fetch contest for startsAt
  const contest = await prisma.contest.findUnique({
    include: {
      participations: {
        where: { userId: { in: [...topUserIds] } },
        select: { id: true, userId: true }
      },
      problems: { select: { problemId: true, points: true } }
    },
    where: { slug: contestSlug }
  });

  if (!contest) return { series: [] };

  const participationIds = contest.participations.map((p) => p.id);
  const participationUserMap = new Map(contest.participations.map((p) => [p.id, p.userId]));
  const pointsMap = new Map(contest.problems.map((p) => [p.problemId, p.points]));

  const submissions = await prisma.submission.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      contestParticipationId: true,
      createdAt: true,
      problemId: true,
      score: true,
      status: true
    },
    where: {
      contestParticipationId: { in: participationIds },
      sampleOnly: false
    }
  });

  const scoringMode = scoreboard.scoringMode;
  const handleMap = new Map(topEntries.map((e) => [e.userId, e.handle]));

  const series = [...topUserIds].map((userId) => {
    const userSubs = submissions.filter(
      (s) => participationUserMap.get(s.contestParticipationId!) === userId
    );

    const points: { time: number; score: number }[] = [{ time: 0, score: 0 }];

    if (scoringMode === "icpc") {
      // Track cumulative solved * points
      const solved = new Set<string>();
      let cumScore = 0;

      for (const sub of userSubs) {
        if (sub.status === "accepted" && !solved.has(sub.problemId)) {
          solved.add(sub.problemId);
          cumScore += pointsMap.get(sub.problemId) ?? 0;
          points.push({
            score: cumScore,
            time: secondsSince(contest.startsAt, sub.createdAt)
          });
        }
      }
    } else {
      // IOI: track cumulative best scores
      const bestByProblem = new Map<string, number>();
      let cumScore = 0;

      for (const sub of userSubs) {
        const current = bestByProblem.get(sub.problemId) ?? 0;
        if (sub.score > current) {
          cumScore += sub.score - current;
          bestByProblem.set(sub.problemId, sub.score);
          points.push({
            score: cumScore,
            time: secondsSince(contest.startsAt, sub.createdAt)
          });
        }
      }
    }

    return {
      handle: handleMap.get(userId) ?? userId,
      points,
      userId
    };
  });

  return { series };
}
