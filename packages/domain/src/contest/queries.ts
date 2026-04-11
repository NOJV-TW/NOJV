import { contestRepo, courseMembershipRepo, runTransaction } from "@nojv/db";
import type { ContestScoringMode, Language, ScoreboardMode } from "@nojv/core";

import { checkIpLock, type IpCheckResult } from "../shared/ip-utils";
import { canManageContest } from "./permissions";

export interface ContestListItem {
  allowedLanguages: Language[];
  endsAt: string;
  ipBindingEnabled: boolean;
  ipWhitelistEnabled: boolean;
  pageLockEnabled: boolean;
  participantCount: number;
  problemCount: number;
  scoreboardMode: ScoreboardMode;
  scoringMode: ContestScoringMode;
  slug: string;
  startsAt: string;
  summary: string;
  title: string;
}

export interface ContestProblemSummary {
  id: string;
  ordinal: number;
  points: number;
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
  isManager: boolean;
  pageLockEnabled: boolean;
  participantCount: number;
  problems: ContestProblemSummary[] | null;
  problemsHidden: boolean;
  scoreboardMode: ScoreboardMode;
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

type ContestWithCounts = NonNullable<
  Awaited<ReturnType<typeof contestRepo.listPublished>>
>[number];

function mapContestListItem(c: ContestWithCounts): ContestListItem {
  return {
    allowedLanguages: c.allowedLanguages as Language[],
    endsAt: c.endsAt.toISOString(),
    ipBindingEnabled: c.ipBindingEnabled,
    ipWhitelistEnabled: c.ipWhitelistEnabled,
    pageLockEnabled: c.pageLockEnabled,
    participantCount: c._count.participations,
    problemCount: c._count.problems,
    scoreboardMode: c.scoreboardMode as ScoreboardMode,
    scoringMode: c.scoringMode,
    slug: c.slug,
    startsAt: c.startsAt.toISOString(),
    summary: c.summary,
    title: c.title
  };
}

type ContestDetailRow = NonNullable<Awaited<ReturnType<typeof contestRepo.findDetailBySlug>>>;

type ContestDetailBase = Omit<ContestDetailData, "isManager" | "problemsHidden" | "problems"> & {
  problems: ContestProblemSummary[];
};

function mapContestDetail(contest: ContestDetailRow): ContestDetailBase {
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
    pageLockEnabled: contest.pageLockEnabled,
    participantCount: contest._count.participations,
    problems: contest.problems.map((cp) => ({
      id: cp.problem.id,
      ordinal: cp.ordinal,
      points: cp.points,
      title: cp.problem.title
    })),
    scoreboardMode: contest.scoreboardMode as ScoreboardMode,
    scoringMode: contest.scoringMode,
    slug: contest.slug,
    startsAt: contest.startsAt.toISOString(),
    submitCooldownSec: contest.submitCooldownSec,
    summary: contest.summary,
    title: contest.title
  };
}

export async function listPublicContests(): Promise<ContestListItem[]> {
  const contests = await contestRepo.listPublished();
  return contests.map(mapContestListItem);
}

export async function listCourseContests(courseSlug: string): Promise<ContestListItem[]> {
  const contests = await contestRepo.listByCourseSlug(courseSlug);
  return contests.map(mapContestListItem);
}

export type ContestDetailOptions = {
  userId: string | null;
  now: Date;
};

export async function getContestDetail(
  contestSlug: string,
  options: ContestDetailOptions
): Promise<ContestDetailData | null> {
  const contest = await contestRepo.findDetailBySlug(contestSlug);
  if (contest?.visibility !== "published") return null;

  const memberships =
    options.userId === null
      ? []
      : await courseMembershipRepo.listActiveForUser(options.userId);

  const isManager = canManageContest(
    options.userId,
    {
      createdByUserId: contest.createdByUserId ?? "",
      courseId: contest.courseId
    },
    memberships
  );

  const problemsHidden = !isManager && options.now < contest.startsAt;

  const base = mapContestDetail(contest);
  return {
    ...base,
    isManager,
    problemsHidden,
    problems: problemsHidden ? null : base.problems
  };
}

export async function getContestWorkspaceData(
  contestSlug: string,
  userId: string,
  options: { now: Date }
): Promise<ContestWorkspaceData | null> {
  const contest = await contestRepo.findWorkspaceBySlug(contestSlug, userId);
  if (contest?.visibility !== "published") return null;

  const memberships = await courseMembershipRepo.listActiveForUser(userId);

  const isManager = canManageContest(
    userId,
    {
      createdByUserId: contest.createdByUserId ?? "",
      courseId: contest.courseId
    },
    memberships
  );

  const problemsHidden = !isManager && options.now < contest.startsAt;

  const base = mapContestDetail(contest);
  const participation = contest.participations[0] ?? null;

  return {
    ...base,
    isManager,
    problemsHidden,
    problems: problemsHidden ? null : base.problems,
    participation: participation
      ? {
          penaltySeconds: participation.penaltySeconds,
          score: participation.score,
          startedAt: participation.startedAt?.toISOString() ?? null,
          status: participation.status
        }
      : null
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
    return checkIpLock(tx, config, clientIp, participation, { userId, contestId });
  });
}
