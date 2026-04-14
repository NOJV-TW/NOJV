import { contestRepo } from "@nojv/db";
import type { ContestScoringMode, Language, ScoreboardMode } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { canManageContest } from "./permissions";

export interface ContestListItem {
  allowedLanguages: Language[];
  endsAt: string;
  id: string;
  participantCount: number;
  problemCount: number;
  scoreboardMode: ScoreboardMode;
  scoringMode: ContestScoringMode;
  slug: string;
  startsAt: string;
  summary: string;
  title: string;
}

export interface ContestListItemForUser extends ContestListItem {
  visibility: "draft" | "published" | "archived";
}

export interface ContestListForUserResult {
  participable: ContestListItem[];
  managed: ContestListItemForUser[];
}

export interface ContestProblemSummary {
  id: string;
  ordinal: number;
  points: number;
  title: string;
}

export interface ContestDetailData {
  allowedLanguages: Language[];
  endsAt: string;
  frozenAt: string | null;
  id: string;
  isManager: boolean;
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
    id: c.id,
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

type ContestDetailBase = Omit<
  ContestDetailData,
  "isManager" | "problemsHidden" | "problems"
> & {
  problems: ContestProblemSummary[];
};

function mapContestDetail(contest: ContestDetailRow): ContestDetailBase {
  return {
    allowedLanguages: contest.allowedLanguages as Language[],
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    id: contest.id,
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

export async function listContestsForUser(
  userId: string | null
): Promise<ContestListForUserResult> {
  if (userId === null) {
    const rows = await contestRepo.listParticipable();
    return { managed: [], participable: rows.map(mapContestListItem) };
  }

  const [managedRows, participableRows] = await Promise.all([
    contestRepo.listManagedForUser(userId),
    contestRepo.listParticipable()
  ]);

  const managedIds = new Set(managedRows.map((c) => c.id));
  const participable = participableRows
    .filter((c) => !managedIds.has(c.id))
    .map(mapContestListItem);

  const managed: ContestListItemForUser[] = managedRows.map((row) => ({
    ...mapContestListItem(row),
    visibility: row.visibility
  }));

  return { managed, participable };
}

export interface ContestDetailOptions {
  userId: string | null;
  now: Date;
}

function resolveVisibility(
  userId: string | null,
  contest: { createdByUserId: string | null; startsAt: Date },
  now: Date
): { isManager: boolean; problemsHidden: boolean } {
  const isManager = canManageContest(userId, { createdByUserId: contest.createdByUserId });
  return {
    isManager,
    problemsHidden: !isManager && now < contest.startsAt
  };
}

export async function getContestDetail(
  contestSlug: string,
  options: ContestDetailOptions
): Promise<ContestDetailData> {
  const contest = await contestRepo.findDetailBySlug(contestSlug);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  const { isManager, problemsHidden } = resolveVisibility(options.userId, contest, options.now);

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
): Promise<ContestWorkspaceData> {
  const contest = await contestRepo.findWorkspaceBySlug(contestSlug, userId);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  const { isManager, problemsHidden } = resolveVisibility(userId, contest, options.now);

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
