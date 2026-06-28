import { contestRepo, participationRepo, submissionRepo } from "@nojv/db";
import {
  submissionVerdicts,
  type ContestScoringMode,
  type Language,
  type PlatformRole,
  type ScoreboardMode,
} from "@nojv/core";

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
  startsAt: string;
  summary: string;
  title: string;
}

export interface ContestListItemForUser extends ContestListItem {
  visibility: "draft" | "published";
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

export interface ContestDetail {
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
  startsAt: string;
  submitCooldownSec: number;
  penaltyMinutesPerWrong: number;
  summary: string;
  title: string;
  visibility: "draft" | "published";
}

export interface ContestWorkspaceDetail extends ContestDetail {
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
    allowedLanguages: c.allowedLanguages,
    endsAt: c.endsAt.toISOString(),
    id: c.id,
    participantCount: c._count.participations,
    problemCount: c._count.problems,
    scoreboardMode: c.scoreboardMode,
    scoringMode: c.scoringMode,
    startsAt: c.startsAt.toISOString(),
    summary: c.summary,
    title: c.title,
  };
}

type ContestDetailRow = NonNullable<Awaited<ReturnType<typeof contestRepo.findDetailById>>>;

type ContestDetailBase = Omit<ContestDetail, "isManager" | "problemsHidden" | "problems"> & {
  problems: ContestProblemSummary[];
};

function mapContestDetail(contest: ContestDetailRow): ContestDetailBase {
  return {
    allowedLanguages: contest.allowedLanguages,
    endsAt: contest.endsAt.toISOString(),
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    id: contest.id,
    participantCount: contest._count.participations,
    problems: contest.problems.map((cp) => ({
      id: cp.problem.id,
      ordinal: cp.ordinal,
      points: cp.points,
      title: cp.problem.title,
    })),
    scoreboardMode: contest.scoreboardMode,
    scoringMode: contest.scoringMode,
    startsAt: contest.startsAt.toISOString(),
    submitCooldownSec: contest.submitCooldownSec,
    penaltyMinutesPerWrong: contest.penaltyMinutesPerWrong,
    summary: contest.summary,
    title: contest.title,
    visibility: contest.visibility,
  };
}

export async function listPublicContests(): Promise<ContestListItem[]> {
  const contests = await contestRepo.listPublished();
  return contests.map(mapContestListItem);
}

export async function listContestsForUser(
  userId: string | null,
): Promise<ContestListForUserResult> {
  if (userId === null) {
    const rows = await contestRepo.listPublished();
    return { managed: [], participable: rows.map(mapContestListItem) };
  }

  const [managedRows, participableRows] = await Promise.all([
    contestRepo.listManagedForUser(userId),
    contestRepo.listPublished(),
  ]);

  const managedIds = new Set(managedRows.map((c) => c.id));
  const participable = participableRows
    .filter((c) => !managedIds.has(c.id))
    .map(mapContestListItem);

  const managed: ContestListItemForUser[] = managedRows.map((row) => ({
    ...mapContestListItem(row),
    visibility: row.visibility,
  }));

  return { managed, participable };
}

export interface ContestDetailOptions {
  userId: string | null;
  platformRole?: PlatformRole | null;
  now: Date;
}

function resolveVisibility(
  userId: string | null,
  platformRole: PlatformRole | null,
  contest: { createdByUserId: string | null; startsAt: Date },
  now: Date,
): { isManager: boolean; problemsHidden: boolean } {
  const isManager = canManageContest(
    userId,
    { createdByUserId: contest.createdByUserId },
    platformRole,
  );
  return {
    isManager,
    problemsHidden: !isManager && now < contest.startsAt,
  };
}

export async function getContestDetail(
  contestId: string,
  options: ContestDetailOptions,
): Promise<ContestDetail> {
  const contest = await contestRepo.findDetailById(contestId);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }

  const { isManager, problemsHidden } = resolveVisibility(
    options.userId,
    options.platformRole ?? null,
    contest,
    options.now,
  );

  const base = mapContestDetail(contest);
  return {
    ...base,
    isManager,
    problemsHidden,
    problems: problemsHidden ? null : base.problems,
  };
}

export async function getContestWorkspaceData(
  contestId: string,
  userId: string,
  options: { now: Date; platformRole?: PlatformRole | null },
): Promise<ContestWorkspaceDetail> {
  const contest = await contestRepo.findWorkspaceById(contestId);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }

  const { isManager, problemsHidden } = resolveVisibility(
    userId,
    options.platformRole ?? null,
    contest,
    options.now,
  );

  const base = mapContestDetail(contest);
  const participation = await participationRepo.findContestParticipation(contestId, userId);

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
          status: participation.status,
        }
      : null,
  };
}

export async function findContestByInviteCode(inviteCode: string) {
  return contestRepo.findByInviteCode(inviteCode);
}

export async function getContestById(id: string) {
  return contestRepo.findById(id);
}

export async function unfreezeContest(contestId: string) {
  const contest = await contestRepo.findById(contestId);
  if (!contest) return null;
  await contestRepo.update(contest.id, { frozenAt: null });
  return { ok: true };
}

export async function listContestParticipantsWithUser(contestId: string) {
  return participationRepo.listContestParticipantsWithUser(contestId);
}

export interface ContestProblemSibling {
  id: string;
  letter: string;
  title: string;
  bestScore?: number | undefined;
  maxScore: number;
  isActive: boolean;
  href: string;
}

function letterForIndex(index: number): string {
  if (index < 0) return String(index + 1);
  if (index < 26) return String.fromCodePoint(65 + index);
  return String(index + 1);
}

export async function listContestProblemSiblings(options: {
  contestId: string;
  problems: ContestProblemSummary[];
  activeProblemId: string;
  actorUserId: string;
}): Promise<ContestProblemSibling[]> {
  if (options.problems.length === 0) return [];

  const problemIds = options.problems.map((p) => p.id);

  const bestRows = await submissionRepo.groupByUserAndProblem({
    contestId: options.contestId,
    userId: options.actorUserId,
    problemId: { in: problemIds },
    sampleOnly: false,
    status: { in: [...submissionVerdicts] },
  });

  const bestByProblemId = new Map<string, number>();
  for (const row of bestRows) {
    if (row._max.score !== null) {
      bestByProblemId.set(row.problemId, row._max.score);
    }
  }

  return options.problems.map((p, index) => ({
    id: p.id,
    letter: letterForIndex(index),
    title: p.title,
    bestScore: bestByProblemId.get(p.id),
    maxScore: p.points,
    isActive: p.id === options.activeProblemId,
    href: `/contests/${options.contestId}/problems/${p.id}`,
  }));
}
