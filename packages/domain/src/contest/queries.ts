import { contestRepo, runTransaction } from "@nojv/db";
import type { AssessmentScoreboardMode, ContestScoringMode, Language } from "@nojv/core";

import { checkIpLock, type IpCheckResult } from "../shared/ip-utils";

// ─── Types ───────────────────────────────────────────────────────────

export interface ContestListItem {
  allowedLanguages: Language[];
  endsAt: string;
  ipBindingEnabled: boolean;
  ipWhitelistEnabled: boolean;
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
  id: string;
  ipBindingEnabled: boolean;
  ipViolationMode: "block" | "notify";
  ipWhitelist: string[];
  ipWhitelistEnabled: boolean;
  maxAttempts: number | null;
  pageLockEnabled: boolean;
  participantCount: number;
  problems: {
    id: string;
    ordinal: number;
    points: number;
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

type ContestWithCounts = NonNullable<
  Awaited<ReturnType<typeof contestRepo.listPublished>>
>[number];

function mapContestListItem(c: ContestWithCounts): ContestListItem {
  return {
    allowedLanguages: c.allowedLanguages as Language[],
    endsAt: c.endsAt.toISOString(),
    ipBindingEnabled: c.ipBindingEnabled,
    ipWhitelistEnabled: c.ipWhitelistEnabled,
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
  const contests = await contestRepo.listPublished();
  return contests.map(mapContestListItem);
}

export async function listCourseContests(courseSlug: string): Promise<ContestListItem[]> {
  const contests = await contestRepo.listByCourseSlug(courseSlug);
  return contests.map(mapContestListItem);
}

export async function getContestDetail(contestSlug: string): Promise<ContestDetailData | null> {
  const contest = await contestRepo.findDetailBySlug(contestSlug);

  if (!contest || contest.visibility !== "published") {
    return null;
  }

  return {
    allowedLanguages: contest.allowedLanguages as Language[],
    courseSlug: contest.course?.slug ?? null,
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    id: contest.id,
    ipBindingEnabled: contest.ipBindingEnabled,
    ipViolationMode: contest.ipViolationMode as "block" | "notify",
    ipWhitelist: contest.ipWhitelist,
    ipWhitelistEnabled: contest.ipWhitelistEnabled,
    maxAttempts: contest.maxAttempts,
    pageLockEnabled: contest.pageLockEnabled,
    participantCount: contest._count.participations,
    problems: contest.problems.map((cp) => ({
      id: cp.problem.id,
      ordinal: cp.ordinal,
      points: cp.points,
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
  const contest = await contestRepo.findWorkspaceBySlug(contestSlug, userId);

  if (!contest || contest.visibility !== "published") {
    return null;
  }

  const participation = contest.participations[0] ?? null;

  return {
    allowedLanguages: contest.allowedLanguages as Language[],
    courseSlug: contest.course?.slug ?? null,
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    id: contest.id,
    ipBindingEnabled: contest.ipBindingEnabled,
    ipViolationMode: contest.ipViolationMode as "block" | "notify",
    ipWhitelist: contest.ipWhitelist,
    ipWhitelistEnabled: contest.ipWhitelistEnabled,
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
      id: cp.problem.id,
      ordinal: cp.ordinal,
      points: cp.points,
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

export async function findContestByInviteCode(inviteCode: string) {
  return contestRepo.findByInviteCode(inviteCode);
}

export async function getContestAllowedLanguages(contestSlug: string): Promise<Language[]> {
  const contest = await contestRepo.findAllowedLanguages(contestSlug);
  return (contest?.allowedLanguages ?? []) as Language[];
}

export async function unfreezeContest(slug: string) {
  const contest = await contestRepo.findBySlug(slug);
  if (!contest) return null;
  await contestRepo.update(contest.id, { frozenAt: null });
  return { ok: true };
}

/**
 * Check IP lock for a contest detail page visit.
 * Returns the IP check result, or null if no participation exists.
 */
export async function getContestParticipationForIpCheck(contestId: string, userId: string) {
  return contestRepo.findParticipation(contestId, userId);
}

/**
 * Run IP lock check for a contest page visit inside a transaction.
 * Encapsulates the full transaction + checkIpLock call so the web layer
 * doesn't need to import `runTransaction` or know about `TransactionClient`.
 */
export async function checkContestIpAccess(
  config: {
    ipWhitelistEnabled: boolean;
    ipBindingEnabled: boolean;
    ipWhitelist: string[];
    ipViolationMode: string;
  },
  clientIp: string,
  contestId: string,
  userId: string,
  participation: { id: string; boundIp: string | null } | null
): Promise<IpCheckResult> {
  return runTransaction(async (tx) => {
    return checkIpLock(
      tx,
      config,
      clientIp,
      participation,
      { userId, contestId },
      "contestParticipation"
    );
  });
}
