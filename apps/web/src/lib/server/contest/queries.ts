import { prisma } from "@nojv/db";
import type {
  AssessmentScoreboardMode,
  ContestScoringMode,
  Language
} from "@nojv/core";

// ─── Types ───────────────────────────────────────────────────────────

export interface ContestListItem {
  allowedLanguages: Language[];
  endsAt: string;
  ipLockEnabled: boolean;
  maxAttempts: number | null;
  pageLockEnabled: boolean;
  participantCount: number;
  problemCount: number;
  scoreboardMode: AssessmentScoreboardMode;
  scoringMode: ContestScoringMode;
  slug: string;
  startsAt: string;
  summary: string;
  title: string;
}

export interface ContestDetailData {
  allowedLanguages: Language[];
  courseSlug: string | null;
  endsAt: string;
  frozenAt: string | null;
  ipLockEnabled: boolean;
  maxAttempts: number | null;
  pageLockEnabled: boolean;
  participantCount: number;
  problems: {
    ordinal: number;
    points: number;
    slug: string;
    title: string;
  }[];
  scoreboardMode: AssessmentScoreboardMode;
  scoringMode: ContestScoringMode;
  slug: string;
  startsAt: string;
  submitCooldownSec: number;
  summary: string;
  title: string;
}

export interface ContestWorkspaceData extends ContestDetailData {
  participation: {
    penaltySeconds: number;
    score: number;
    startedAt: string | null;
    status: string;
  } | null;
}

// ─── Internal helpers ────────────────────────────────────────────────

const contestListInclude = {
  _count: { select: { participations: true, problems: true } }
} as const;

type ContestWithCounts = Awaited<
  ReturnType<typeof prisma.contest.findMany<{ include: typeof contestListInclude }>>
>[number];

function mapContestListItem(c: ContestWithCounts): ContestListItem {
  return {
    allowedLanguages: c.allowedLanguages as Language[],
    endsAt: c.endsAt.toISOString(),
    ipLockEnabled: c.ipLockEnabled,
    maxAttempts: c.maxAttempts,
    pageLockEnabled: c.pageLockEnabled,
    participantCount: c._count.participations,
    problemCount: c._count.problems,
    scoreboardMode: c.scoreboardMode as AssessmentScoreboardMode,
    scoringMode: c.scoringMode,
    slug: c.slug,
    startsAt: c.startsAt.toISOString(),
    summary: c.summary,
    title: c.title
  };
}

// ─── Public query functions ──────────────────────────────────────────

export async function listPublicContests(): Promise<ContestListItem[]> {
  const contests = await prisma.contest.findMany({
    include: contestListInclude,
    orderBy: { startsAt: "desc" },
    where: {
      courseId: null,
      visibility: "published"
    }
  });

  return contests.map(mapContestListItem);
}

export async function listCourseContests(courseSlug: string): Promise<ContestListItem[]> {
  const contests = await prisma.contest.findMany({
    include: contestListInclude,
    orderBy: { startsAt: "desc" },
    where: {
      course: { slug: courseSlug },
      visibility: "published"
    }
  });

  return contests.map(mapContestListItem);
}

export async function getContestDetail(contestSlug: string): Promise<ContestDetailData | null> {
  const contest = await prisma.contest.findUnique({
    include: {
      _count: { select: { participations: true } },
      course: { select: { slug: true } },
      problems: {
        include: {
          problem: { select: { defaultTitle: true, slug: true } }
        },
        orderBy: { ordinal: "asc" }
      }
    },
    where: { slug: contestSlug }
  });

  if (!contest || contest.visibility !== "published") {
    return null;
  }

  return {
    allowedLanguages: contest.allowedLanguages as Language[],
    courseSlug: contest.course?.slug ?? null,
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    ipLockEnabled: contest.ipLockEnabled,
    maxAttempts: contest.maxAttempts,
    pageLockEnabled: contest.pageLockEnabled,
    participantCount: contest._count.participations,
    problems: contest.problems.map((cp) => ({
      ordinal: cp.ordinal,
      points: cp.points,
      slug: cp.problem.slug,
      title: cp.problem.defaultTitle
    })),
    scoreboardMode: contest.scoreboardMode as AssessmentScoreboardMode,
    scoringMode: contest.scoringMode,
    slug: contest.slug,
    startsAt: contest.startsAt.toISOString(),
    submitCooldownSec: contest.submitCooldownSec,
    summary: contest.summary,
    title: contest.title
  };
}

export async function getContestWorkspaceData(
  contestSlug: string,
  userId: string
): Promise<ContestWorkspaceData | null> {
  const contest = await prisma.contest.findUnique({
    include: {
      _count: { select: { participations: true } },
      course: { select: { slug: true } },
      participations: {
        where: { userId },
        take: 1
      },
      problems: {
        include: {
          problem: { select: { defaultTitle: true, slug: true } }
        },
        orderBy: { ordinal: "asc" }
      }
    },
    where: { slug: contestSlug }
  });

  if (!contest || contest.visibility !== "published") {
    return null;
  }

  const participation = contest.participations[0] ?? null;

  return {
    allowedLanguages: contest.allowedLanguages as Language[],
    courseSlug: contest.course?.slug ?? null,
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    ipLockEnabled: contest.ipLockEnabled,
    maxAttempts: contest.maxAttempts,
    pageLockEnabled: contest.pageLockEnabled,
    participation: participation
      ? {
          penaltySeconds: participation.penaltySeconds,
          score: participation.score,
          startedAt: participation.startedAt?.toISOString() ?? null,
          status: participation.status
        }
      : null,
    participantCount: contest._count.participations,
    problems: contest.problems.map((cp) => ({
      ordinal: cp.ordinal,
      points: cp.points,
      slug: cp.problem.slug,
      title: cp.problem.defaultTitle
    })),
    scoreboardMode: contest.scoreboardMode as AssessmentScoreboardMode,
    scoringMode: contest.scoringMode,
    slug: contest.slug,
    startsAt: contest.startsAt.toISOString(),
    submitCooldownSec: contest.submitCooldownSec,
    summary: contest.summary,
    title: contest.title
  };
}

export async function getActiveContestForUser(userId: string) {
  const now = new Date();

  return prisma.contest.findFirst({
    where: {
      pageLockEnabled: true,
      visibility: "published",
      startsAt: { lte: now },
      endsAt: { gte: now },
      participations: {
        some: { userId, status: "active" }
      }
    },
    select: {
      courseId: true,
      slug: true,
      course: { select: { slug: true } }
    }
  });
}

export async function getContestAllowedLanguages(
  contestSlug: string
): Promise<Language[]> {
  const contest = await prisma.contest.findUnique({
    where: { slug: contestSlug },
    select: { allowedLanguages: true }
  });

  return (contest?.allowedLanguages ?? []) as Language[];
}
