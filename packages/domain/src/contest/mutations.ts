import crypto from "node:crypto";

import {
  contestParticipationRepo,
  contestProblemRepo,
  contestRepo,
  problemRepo,
  runTransaction,
  submissionRepo,
  type Prisma,
  type TransactionClient,
} from "@nojv/db";
import {
  contestScoringModeSchema,
  languageSchema,
  scoreboardModeSchema,
  slugSchema,
  type ContestCreate,
  type ContestUpdate,
  type Language,
} from "@nojv/core";
import { z } from "zod";

import { scoreboard } from "@nojv/redis";
import { dispatchContestLifecycle } from "@nojv/temporal";

export const contestFormSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  endsAt: z.string().min(1),
  frozenAt: z.string().optional(),
  inviteCode: z.string().max(32).optional(),
  problemIdsText: z.string().min(1),
  scoreboardMode: scoreboardModeSchema.default("live"),
  scoringMode: contestScoringModeSchema.default("problem_count"),
  id: slugSchema,
  startsAt: z.string().min(1),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().min(8).max(4_000),
  title: z.string().min(3).max(120),
});

import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { requireContest, requireUser } from "../shared/require";
import { canEditProblem } from "../shared/permissions";
import { assertProblemHasWorkspaceForLanguages } from "../problem/permissions";
import { stripUndefined } from "../shared/strip-undefined";

export type { ActorContext };

async function resolveAndAttachContestProblems(
  tx: TransactionClient,
  contestId: string,
  problemIds: string[],
  allowedLanguages: Language[],
) {
  const problems = await problemRepo.withTx(tx).findMany({
    id: { in: problemIds },
  });
  const problemById = new Map(problems.map((p) => [p.id, p]));

  for (const id of problemIds) {
    if (!problemById.has(id)) {
      throw new NotFoundError(`Problem not found: ${id}`);
    }
  }

  if (allowedLanguages.length > 0) {
    await Promise.all(
      problemIds.map((id) => assertProblemHasWorkspaceForLanguages(tx, id, allowedLanguages)),
    );
  }

  await Promise.all(
    problemIds.map(async (id, index) => {
      const problem = problemById.get(id);
      if (!problem) return;
      await contestProblemRepo.withTx(tx).create({
        contestId,
        ordinal: index + 1,
        points: 100,
        problemId: problem.id,
      });
    }),
  );
}

export async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestId: string,
  attemptContext?: { problemId: string; sampleOnly: boolean },
) {
  const contest = await requireContest(tx, contestId);

  if (contest.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }

  const now = new Date();
  if (now < contest.startsAt) {
    throw new ForbiddenError("Contest has not started yet.");
  }
  if (now > contest.endsAt) {
    throw new ForbiddenError("Contest has ended.");
  }

  const participation = await contestParticipationRepo.withTx(tx).upsert(
    contest.id,
    userId,
    {
      contestId: contest.id,
      startedAt: new Date(),
      status: "active",
      userId,
    },
    {
      status: "active",
    },
  );

  void attemptContext;

  return { contest, participation };
}

export async function checkSubmitCooldown(
  tx: TransactionClient,
  contestId: string,
  userId: string,
  problemId: string,
  cooldownSec: number,
) {
  if (cooldownSec <= 0) return;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${contestId}:${userId}:${problemId}`}, 0))`;

  const cutoff = new Date(Date.now() - cooldownSec * 1000);

  const recentSubmission = await submissionRepo.withTx(tx).findMostRecent({
    contestParticipation: {
      contestId,
      userId,
    },
    problemId,
    sampleOnly: false,
    createdAt: { gte: cutoff },
  });

  if (recentSubmission) {
    const waitUntil = new Date(recentSubmission.createdAt.getTime() + cooldownSec * 1000);
    const remainingSec = Math.ceil((waitUntil.getTime() - Date.now()) / 1000);
    throw new ForbiddenError(
      `Submit cooldown active. Please wait ${String(remainingSec)} seconds.`,
    );
  }
}

export async function createContestRecord(actor: ActorContext, payload: ContestCreate) {
  if (!canEditProblem(actor.platformRole)) {
    throw new ForbiddenError("Only teachers and admins can create contests.");
  }

  const contest = await runTransaction(async (tx) => {
    const existing = await contestRepo.withTx(tx).findById(payload.id);

    if (existing) {
      throw new ConflictError(`Contest id already exists: ${payload.id}`);
    }

    await requireUser(tx, actor.userId);

    const inviteCode = payload.inviteCode ?? crypto.randomBytes(4).toString("hex");

    const contest = await contestRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      inviteCode,
      createdByUserId: actor.userId,
      endsAt: new Date(payload.endsAt),
      frozenAt: payload.frozenAt ? new Date(payload.frozenAt) : null,
      scoreboardMode: payload.scoreboardMode,
      scoringMode: payload.scoringMode,
      id: payload.id,
      startsAt: new Date(payload.startsAt),
      submitCooldownSec: payload.submitCooldownSec,
      summary: payload.summary,
      title: payload.title,
      visibility: "published",
    });

    await resolveAndAttachContestProblems(
      tx,
      contest.id,
      payload.problemIds,
      payload.allowedLanguages,
    );

    return contest;
  });

  await dispatchContestLifecycle({ contestId: contest.id });
  return contest;
}

export async function updateContestRecord(
  actor: ActorContext,
  contestId: string,
  payload: ContestUpdate,
) {
  return runTransaction(async (tx) => {
    const contest = await requireContest(tx, contestId);

    if (contest.createdByUserId !== actor.userId && actor.platformRole !== "admin") {
      throw new ForbiddenError("You do not have permission to edit this contest.");
    }

    const updateData: Prisma.ContestUncheckedUpdateInput = stripUndefined({
      title: payload.title,
      summary: payload.summary,
      scoringMode: payload.scoringMode,
      submitCooldownSec: payload.submitCooldownSec,
      allowedLanguages: payload.allowedLanguages,
      scoreboardMode: payload.scoreboardMode,
    });

    if (payload.startsAt !== undefined) updateData.startsAt = new Date(payload.startsAt);
    if (payload.endsAt !== undefined) updateData.endsAt = new Date(payload.endsAt);
    if (payload.frozenAt !== undefined) {
      updateData.frozenAt = payload.frozenAt ? new Date(payload.frozenAt) : null;
    }

    if (Object.keys(updateData).length > 0) {
      await contestRepo.withTx(tx).update(contest.id, updateData);
    }

    if (payload.problemIds !== undefined) {
      await contestProblemRepo.withTx(tx).deleteByContestId(contest.id);

      const enforcedLanguages = payload.allowedLanguages ?? contest.allowedLanguages;
      await resolveAndAttachContestProblems(
        tx,
        contest.id,
        payload.problemIds,
        enforcedLanguages,
      );
    }

    return { id: contest.id };
  });
}

export interface ContestLifecycleSnapshot {
  endsAt: string;
  freezeTime: string | null;
  scoringMode: string;
  startsAt: string;
}

export async function getContestLifecycleInfo(
  contestId: string,
): Promise<ContestLifecycleSnapshot> {
  const contest = await contestRepo.findInfoById(contestId);
  return {
    endsAt: contest.endsAt.toISOString(),
    freezeTime: contest.frozenAt?.toISOString() ?? null,
    scoringMode: contest.scoringMode,
    startsAt: contest.startsAt.toISOString(),
  };
}

export async function activateContest(contestId: string): Promise<void> {
  await contestRepo.update(contestId, { visibility: "published" });
}

async function assertContestManageable(
  tx: TransactionClient,
  actor: ActorContext,
  contestId: string,
) {
  const contest = await requireContest(tx, contestId);
  if (contest.createdByUserId !== actor.userId && actor.platformRole !== "admin") {
    throw new ForbiddenError("You do not have permission to manage this contest.");
  }
  return contest;
}

export async function publishContest(actor: ActorContext, contestId: string): Promise<void> {
  await runTransaction(async (tx) => {
    const contest = await assertContestManageable(tx, actor, contestId);

    if (contest.visibility !== "draft") {
      throw new ValidationError("Only draft contests can be published.");
    }

    const problemCount = await contestProblemRepo.withTx(tx).countByContestId(contest.id);
    if (problemCount === 0) {
      throw new ValidationError("Add at least one problem before publishing.");
    }
    if (contest.allowedLanguages.length === 0) {
      throw new ValidationError("Select at least one allowed language before publishing.");
    }
    if (contest.startsAt >= contest.endsAt) {
      throw new ValidationError("Start time must be before end time.");
    }
    if (contest.endsAt <= new Date()) {
      throw new ValidationError("End time must be in the future.");
    }

    await contestRepo.withTx(tx).update(contest.id, { visibility: "published" });
  });

  await dispatchContestLifecycle({ contestId });
}

export async function deleteContestDraft(
  actor: ActorContext,
  contestId: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    const contest = await assertContestManageable(tx, actor, contestId);

    if (contest.visibility !== "draft") {
      throw new ValidationError("Only draft contests can be deleted.");
    }

    await contestRepo.withTx(tx).delete(contest.id);
  });
}

export async function freezeContestBoard(contestId: string): Promise<void> {
  const contest = await contestRepo.findById(contestId);
  const ttl = contest ? scoreboard.scoreboardTtlForEndsAt(contest.endsAt) : undefined;
  await scoreboard.freezeScoreboard(contestId, ttl);
  await contestRepo.update(contestId, { frozenBoard: true });
}

export async function finalizeContest(contestId: string): Promise<void> {
  await scoreboard.unfreezeScoreboard(contestId);
  await contestRepo.update(contestId, { frozenBoard: false });
}
