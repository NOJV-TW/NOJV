import {
  contestProblemRepo,
  contestRepo,
  participationRepo,
  problemRepo,
  runTransaction,
  type Prisma,
  type TransactionClient,
} from "@nojv/db";
import {
  contestScoringModeSchema,
  languageSchema,
  scoreboardModeSchema,
  slugSchema,
  type ContestCreate,
  type ContestProblemInput,
  type ContestScoringMode,
  type ContestUpdate,
  type Language,
} from "@nojv/core";
import { z } from "zod";

export const contestFormSchema = z
  .object({
    allowedLanguages: z.array(languageSchema).max(8).default([]),
    endsAt: z.string().min(1),
    frozenAt: z.string().optional(),
    inviteCode: z.string().max(32).optional(),
    isPublic: z.boolean().default(true),
    problems: z
      .array(
        z.object({
          problemId: z.string().trim().min(1),
          points: z.coerce.number().int().min(1).max(100_000).default(100),
        }),
      )
      .min(1)
      .max(32)
      .default([{ problemId: "", points: 100 }]),
    scoreboardMode: scoreboardModeSchema.default("live"),
    scoringMode: contestScoringModeSchema.default("problem_count"),
    id: slugSchema,
    startsAt: z.string().min(1),
    submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
    penaltyMinutesPerWrong: z.coerce.number().int().min(0).max(1440).default(20),
    summary: z.string().min(8).max(4_000),
    title: z.string().min(3).max(120),
  })
  .superRefine((data, ctx) => {
    if (!data.isPublic && (data.inviteCode ?? "").trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Invite code is required for private contests.",
        path: ["inviteCode"],
      });
    }
  });

import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { requireContest, requireUser } from "../shared/require";
import { canManageContest } from "./permissions";
import type { PlatformRole } from "@nojv/core";
import { canEditProblem } from "../shared/permissions";
import { assertProblemHasWorkspaceForLanguages } from "../problem/permissions";
import { getProblemTotalScore } from "../problem/total-score";
import { stripUndefined } from "../shared/strip-undefined";
import { getDomainOrchestration } from "../shared/orchestration";
import { enforceSubmitCooldown } from "../shared/submit-cooldown";

export type { ActorContext };

async function resolveAndAttachContestProblems(
  tx: TransactionClient,
  contestId: string,
  problems: ContestProblemInput[],
  allowedLanguages: Language[],
  scoringMode: ContestScoringMode,
) {
  const problemIds = problems.map((p) => p.problemId);
  const found = await problemRepo.withTx(tx).findMany({
    id: { in: problemIds },
  });
  const problemById = new Map(found.map((p) => [p.id, p]));

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
    problems.map(async (entry, index) => {
      const problem = problemById.get(entry.problemId);
      if (!problem) return;
      const points =
        scoringMode === "weighted_count"
          ? entry.points
          : await getProblemTotalScore(tx, problem);
      await contestProblemRepo.withTx(tx).create({
        contestId,
        ordinal: index + 1,
        points,
        problemId: problem.id,
      });
    }),
  );
}

export async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestId: string,
  platformRole?: PlatformRole | null,
) {
  const contest = await requireContest(tx, contestId);

  if (contest.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }

  const now = new Date();
  if (now < contest.startsAt) {
    throw new ForbiddenError("Contest has not started yet.");
  }
  if (now >= contest.endsAt) {
    throw new ForbiddenError("Contest has ended.");
  }

  // Participants must join before submitting; managers/admins are auto-joined
  // (operational access, consistent with the contest problem-route gate).
  if (!canManageContest(userId, contest, platformRole)) {
    const existing = await participationRepo
      .withTx(tx)
      .findContestParticipation(contestId, userId);
    if (!existing) {
      throw new ForbiddenError("You must join the contest before submitting.");
    }
  }

  const participation = await participationRepo
    .withTx(tx)
    .upsertContestActive(contest.id, userId, new Date());

  return { contest, participation };
}

export async function checkSubmitCooldown(
  tx: TransactionClient,
  contestId: string,
  userId: string,
  problemId: string,
  cooldownSec: number,
) {
  await enforceSubmitCooldown(tx, { contestId }, userId, problemId, cooldownSec);
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

    const inviteCode = payload.inviteCode ?? null;

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
      penaltyMinutesPerWrong: payload.penaltyMinutesPerWrong,
      summary: payload.summary,
      title: payload.title,
      visibility: "published",
    });

    await resolveAndAttachContestProblems(
      tx,
      contest.id,
      payload.problems,
      payload.allowedLanguages,
      payload.scoringMode,
    );

    return contest;
  });

  await getDomainOrchestration().dispatchContestLifecycle({ contestId: contest.id });
  return contest;
}

export async function joinContestByCode(
  actor: ActorContext,
  code: string,
): Promise<{ contestId: string }> {
  const contest = await contestRepo.findByInviteCode(code);
  if (contest?.visibility !== "published") {
    throw new NotFoundError("No contest matches that invite code.");
  }

  await runTransaction(async (tx) => {
    await requireUser(tx, actor.userId);
    await participationRepo.withTx(tx).upsertContestRegistered(contest.id, actor.userId);
  });

  return { contestId: contest.id };
}

/**
 * Explicit join for a PUBLIC contest (no invite code). Registers the actor as a
 * participant so they may submit. Allowed before and during the contest (until
 * it ends). Private/invite-code contests must be joined via `joinContestByCode`.
 */
export async function joinContest(
  actor: ActorContext,
  contestId: string,
): Promise<{ contestId: string }> {
  await runTransaction(async (tx) => {
    const contest = await requireContest(tx, contestId);
    if (contest.visibility !== "published") {
      throw new NotFoundError(`Contest not found: ${contestId}`);
    }
    if (contest.inviteCode) {
      throw new ForbiddenError("This contest requires an invite code to join.");
    }
    if (new Date() >= contest.endsAt) {
      throw new ForbiddenError("Contest has ended.");
    }
    await requireUser(tx, actor.userId);
    await participationRepo.withTx(tx).upsertContestRegistered(contest.id, actor.userId);
  });
  return { contestId };
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
      penaltyMinutesPerWrong: payload.penaltyMinutesPerWrong,
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

    const editable = contest.visibility === "draft" || contest.startsAt > new Date();
    if (payload.problems !== undefined && editable) {
      await contestProblemRepo.withTx(tx).deleteByContestId(contest.id);

      const enforcedLanguages = payload.allowedLanguages ?? contest.allowedLanguages;
      await resolveAndAttachContestProblems(
        tx,
        contest.id,
        payload.problems,
        enforcedLanguages,
        payload.scoringMode ?? contest.scoringMode,
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

  await getDomainOrchestration().dispatchContestLifecycle({ contestId });
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
  await contestRepo.update(contestId, { frozenBoard: true });
}

export async function finalizeContest(contestId: string): Promise<void> {
  await contestRepo.update(contestId, { frozenBoard: false });
}
