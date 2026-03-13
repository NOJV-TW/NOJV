import { prisma } from "@nojv/db";
import type { ContestScoringMode } from "@nojv/core";

// ─── Types ───────────────────────────────────────────────────────────

export interface ContestListItem {
  endsAt: string;
  participantCount: number;
  problemCount: number;
  scoringMode: ContestScoringMode;
  slug: string;
  startsAt: string;
  summary: string;
  title: string;
}

export interface ContestDetailData {
  courseSlug: string | null;
  endsAt: string;
  frozenAt: string | null;
  participantCount: number;
  problems: {
    ordinal: number;
    points: number;
    slug: string;
    title: string;
  }[];
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

// ─── Public query functions ──────────────────────────────────────────

export async function listPublicContests(): Promise<ContestListItem[]> {
  const contests = await prisma.contest.findMany({
    include: {
      _count: {
        select: {
          participations: true,
          problems: true
        }
      }
    },
    orderBy: { startsAt: "desc" },
    where: {
      courseId: null,
      visibility: "published"
    }
  });

  return contests.map((c) => ({
    endsAt: c.endsAt.toISOString(),
    participantCount: c._count.participations,
    problemCount: c._count.problems,
    scoringMode: c.scoringMode,
    slug: c.slug,
    startsAt: c.startsAt.toISOString(),
    summary: c.summary,
    title: c.title
  }));
}

export async function listCourseContests(courseSlug: string): Promise<ContestListItem[]> {
  const contests = await prisma.contest.findMany({
    include: {
      _count: {
        select: {
          participations: true,
          problems: true
        }
      }
    },
    orderBy: { startsAt: "desc" },
    where: {
      course: { slug: courseSlug },
      visibility: "published"
    }
  });

  return contests.map((c) => ({
    endsAt: c.endsAt.toISOString(),
    participantCount: c._count.participations,
    problemCount: c._count.problems,
    scoringMode: c.scoringMode,
    slug: c.slug,
    startsAt: c.startsAt.toISOString(),
    summary: c.summary,
    title: c.title
  }));
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
    courseSlug: contest.course?.slug ?? null,
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    participantCount: contest._count.participations,
    problems: contest.problems.map((cp) => ({
      ordinal: cp.ordinal,
      points: cp.points,
      slug: cp.problem.slug,
      title: cp.problem.defaultTitle
    })),
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
    courseSlug: contest.course?.slug ?? null,
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
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
    scoringMode: contest.scoringMode,
    slug: contest.slug,
    startsAt: contest.startsAt.toISOString(),
    submitCooldownSec: contest.submitCooldownSec,
    summary: contest.summary,
    title: contest.title
  };
}
