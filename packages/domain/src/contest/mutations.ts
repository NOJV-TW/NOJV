import crypto from "node:crypto";

import {
  contestParticipationRepo,
  contestProblemRepo,
  contestRepo,
  courseRepo,
  courseMembershipRepo,
  problemRepo,
  runTransaction,
  submissionRepo,
  userRepo,
  type Prisma,
  type TransactionClient
} from "@nojv/db";
import type { ContestCreate, ContestUpdate, Language } from "@nojv/core";

import { scoreboard } from "@nojv/redis";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { assertProblemHasWorkspaceForLanguages } from "../problem/mutations";
import { stripUndefined } from "../shared/strip-undefined";

export type { ActorContext };

// ─── Internal helpers ────────────────────────────────────────────────

async function requireContest(tx: TransactionClient, contestSlug: string) {
  const contest = await contestRepo.withTx(tx).findBySlug(contestSlug);

  if (!contest) {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  return contest;
}

async function requireCourse(tx: TransactionClient, courseSlug: string) {
  const course = await courseRepo.withTx(tx).findBySlug(courseSlug);

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseSlug}`);
  }

  return course;
}

async function requireUser(tx: TransactionClient, userId: string) {
  const existing = await userRepo.withTx(tx).findById(userId);
  if (!existing) {
    throw new NotFoundError(`User not found: ${userId}`);
  }
  return existing;
}

async function resolveAndAttachContestProblems(
  tx: TransactionClient,
  contestId: string,
  problemIds: string[],
  allowedLanguages: Language[]
) {
  const problems = await problemRepo.withTx(tx).findMany({
    id: { in: problemIds }
  });
  const problemById = new Map(problems.map((p) => [p.id, p]));

  for (const id of problemIds) {
    if (!problemById.has(id)) {
      throw new NotFoundError(`Problem not found: ${id}`);
    }
  }

  // Workspace invariant: every listed allowedLanguage must have an
  // editable main.<ext> on every problem in the contest. Empty list =
  // unrestricted, no check.
  if (allowedLanguages.length > 0) {
    for (const id of problemIds) {
      await assertProblemHasWorkspaceForLanguages(tx, id, allowedLanguages);
    }
  }

  await Promise.all(
    problemIds.map(async (id, index) => {
      const problem = problemById.get(id);
      if (!problem) return;
      await contestProblemRepo.withTx(tx).create({
        contestId,
        ordinal: index + 1,
        points: 100,
        problemId: problem.id
      });
    })
  );
}

// ─── Contest participation ───────────────────────────────────────────

export async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestSlug: string,
  /** Pass problemId + sampleOnly to enforce maxAttempts; omit for participation-only */
  attemptContext?: { problemId: string; sampleOnly: boolean }
) {
  const contest = await requireContest(tx, contestSlug);

  if (contest.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  const now = new Date();
  if (now < contest.startsAt) {
    throw new ForbiddenError("Contest has not started yet.");
  }
  if (now > contest.endsAt) {
    throw new ForbiddenError("Contest has ended.");
  }

  // If contest is linked to a course, verify course membership
  if (contest.courseId) {
    const membership = await courseMembershipRepo
      .withTx(tx)
      .findByComposite(contest.courseId, userId);

    if (membership?.status !== "active") {
      throw new ForbiddenError("You must be enrolled in the course to participate.");
    }
  }

  const participation = await contestParticipationRepo.withTx(tx).upsert(
    contest.id,
    userId,
    {
      contestId: contest.id,
      startedAt: new Date(),
      status: "active",
      userId
    },
    {
      status: "active"
    }
  );

  // The Phase 1 redesign moved per-problem attempt limits onto
  // CourseAssessment only — Contest no longer carries `maxAttempts`.
  // The `attemptContext` parameter is preserved so the caller signature
  // doesn't change, but it's currently unused for contests. Keep the
  // unused-binding eslint exception via void to make intent clear.
  void attemptContext;

  return { contest, participation };
}

// ─── Submit cooldown check ──────────────────────────────────────────

export async function checkSubmitCooldown(
  tx: TransactionClient,
  contestId: string,
  userId: string,
  problemId: string,
  cooldownSec: number
) {
  if (cooldownSec <= 0) return;

  const cutoff = new Date(Date.now() - cooldownSec * 1000);

  const recentSubmission = await submissionRepo.withTx(tx).findMostRecent({
    contestParticipation: {
      contestId,
      userId
    },
    problemId,
    sampleOnly: false,
    createdAt: { gte: cutoff }
  });

  if (recentSubmission) {
    const waitUntil = new Date(recentSubmission.createdAt.getTime() + cooldownSec * 1000);
    const remainingSec = Math.ceil((waitUntil.getTime() - Date.now()) / 1000);
    throw new ForbiddenError(
      `Submit cooldown active. Please wait ${String(remainingSec)} seconds.`
    );
  }
}

// ─── Contest creation ───────────────────────────────────────────────

export async function createContestRecord(actor: ActorContext, payload: ContestCreate) {
  return runTransaction(async (tx) => {
    const existing = await contestRepo.withTx(tx).findBySlug(payload.slug);

    if (existing) {
      throw new ConflictError(`Contest slug already exists: ${payload.slug}`);
    }

    await requireUser(tx, actor.userId);

    // Students cannot bind contests to courses (enforced at route level too)
    if (payload.courseSlug && actor.platformRole === "student") {
      throw new ForbiddenError("Students cannot bind contests to courses.");
    }

    const courseId = payload.courseSlug
      ? (await requireCourse(tx, payload.courseSlug)).id
      : null;

    // Use user-provided invite code, or auto-generate for public contests
    const inviteCode =
      payload.inviteCode ?? (courseId ? null : crypto.randomBytes(4).toString("hex"));

    const contest = await contestRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      courseId,
      inviteCode,
      createdByUserId: actor.userId,
      endsAt: new Date(payload.endsAt),
      frozenAt: payload.frozenAt ? new Date(payload.frozenAt) : null,
      ipBindingEnabled: payload.ipBindingEnabled,
      ipViolationMode: payload.ipViolationMode,
      ipWhitelist: payload.ipWhitelist,
      ipWhitelistEnabled: payload.ipWhitelistEnabled,
      pageLockEnabled: payload.pageLockEnabled,
      scoreboardMode: payload.scoreboardMode,
      scoringMode: payload.scoringMode,
      slug: payload.slug,
      startsAt: new Date(payload.startsAt),
      submitCooldownSec: payload.submitCooldownSec,
      summary: payload.summary,
      title: payload.title,
      visibility: "published"
    });

    await resolveAndAttachContestProblems(
      tx,
      contest.id,
      payload.problemIds,
      payload.allowedLanguages
    );

    return contest;
  });
}

// ─── Contest update ─────────────────────────────────────────────────

export async function updateContestRecord(
  actor: ActorContext,
  contestSlug: string,
  payload: ContestUpdate
) {
  return runTransaction(async (tx) => {
    const contest = await requireContest(tx, contestSlug);

    const updateData: Prisma.ContestUncheckedUpdateInput = stripUndefined({
      title: payload.title,
      summary: payload.summary,
      scoringMode: payload.scoringMode,
      submitCooldownSec: payload.submitCooldownSec,
      allowedLanguages: payload.allowedLanguages,
      ipWhitelistEnabled: payload.ipWhitelistEnabled,
      ipBindingEnabled: payload.ipBindingEnabled,
      ipWhitelist: payload.ipWhitelist,
      ipViolationMode: payload.ipViolationMode,
      pageLockEnabled: payload.pageLockEnabled,
      scoreboardMode: payload.scoreboardMode
    });

    // Fields that need transformation or null-coalescing.
    if (payload.startsAt !== undefined) updateData.startsAt = new Date(payload.startsAt);
    if (payload.endsAt !== undefined) updateData.endsAt = new Date(payload.endsAt);
    if (payload.frozenAt !== undefined) {
      updateData.frozenAt = payload.frozenAt ? new Date(payload.frozenAt) : null;
    }
    if (payload.courseSlug !== undefined) {
      updateData.courseId = payload.courseSlug
        ? (await requireCourse(tx, payload.courseSlug)).id
        : null;
    }

    if (Object.keys(updateData).length > 0) {
      await contestRepo.withTx(tx).update(contest.id, updateData);
    }

    // Replace problems if provided. Re-check the workspace invariant
    // against either the new allowedLanguages (if set) or the contest's
    // current value.
    if (payload.problemIds !== undefined) {
      await contestProblemRepo.withTx(tx).deleteByContestId(contest.id);

      const enforcedLanguages =
        payload.allowedLanguages ?? (contest.allowedLanguages as Language[]);
      await resolveAndAttachContestProblems(
        tx,
        contest.id,
        payload.problemIds,
        enforcedLanguages
      );
    }

    return { id: contest.id };
  });
}

// ─── Lifecycle (called by temporal activities) ──────────────────────

export interface ContestLifecycleInfo {
  endsAt: string;
  freezeTime: string | null;
  scoringMode: string;
  startsAt: string;
}

export async function getContestLifecycleInfo(
  contestId: string
): Promise<ContestLifecycleInfo> {
  const contest = await contestRepo.findInfoById(contestId);
  return {
    endsAt: contest.endsAt.toISOString(),
    freezeTime: contest.frozenAt?.toISOString() ?? null,
    scoringMode: contest.scoringMode,
    startsAt: contest.startsAt.toISOString()
  };
}

export async function activateContest(contestId: string): Promise<void> {
  await contestRepo.update(contestId, { visibility: "published" });
}

export async function freezeContestBoard(contestId: string): Promise<void> {
  await scoreboard.freezeScoreboard(contestId);
  await contestRepo.update(contestId, { frozenBoard: true });
}

export async function finalizeContest(contestId: string): Promise<void> {
  await scoreboard.unfreezeScoreboard(contestId);
  await contestRepo.update(contestId, { frozenBoard: false, visibility: "archived" });
}
