import { prisma, type Prisma, type TransactionClient } from "@nojv/db";
import type { ContestCreate, ContestUpdate } from "@nojv/core";

import type { CompletedActorContext } from "../auth";
import { ConflictError, ForbiddenError, NotFoundError } from "../auth";
import { ensureUser } from "../user/mutations";
import { requireCourse } from "../course/mutations";

// ─── Internal helpers ────────────────────────────────────────────────

async function requireContest(tx: TransactionClient, contestSlug: string) {
  const contest = await tx.contest.findUnique({
    where: { slug: contestSlug }
  });

  if (!contest) {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  return contest;
}

async function resolveAndAttachContestProblems(
  tx: TransactionClient,
  contestId: string,
  problemSlugs: string[]
) {
  const problems = await tx.problem.findMany({
    where: { slug: { in: problemSlugs } }
  });
  const problemBySlug = new Map(problems.map((p) => [p.slug, p]));

  for (const slug of problemSlugs) {
    if (!problemBySlug.has(slug)) {
      throw new NotFoundError(`Problem not found: ${slug}`);
    }
  }

  await Promise.all(
    problemSlugs.map(async (slug, index) => {
      const problem = problemBySlug.get(slug);
      if (!problem) return;
      await tx.contestProblem.create({
        data: {
          contestId,
          ordinal: index + 1,
          points: 100,
          problemId: problem.id
        }
      });
    })
  );
}

// ─── Contest participation ───────────────────────────────────────────

export async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestSlug: string
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
    const membership = await tx.courseMembership.findUnique({
      where: {
        courseId_userId: {
          courseId: contest.courseId,
          userId
        }
      }
    });

    if (membership?.status !== "active") {
      throw new ForbiddenError("You must be enrolled in the course to participate.");
    }
  }

  const participation = await tx.contestParticipation.upsert({
    create: {
      contestId: contest.id,
      startedAt: new Date(),
      status: "active",
      userId
    },
    update: {
      status: "active"
    },
    where: {
      contestId_userId: {
        contestId: contest.id,
        userId
      }
    }
  });

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

  const recentSubmission = await tx.submission.findFirst({
    where: {
      contestParticipation: {
        contestId,
        userId
      },
      problemId,
      sampleOnly: false,
      createdAt: { gte: cutoff }
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true }
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

export async function createContestRecord(
  actor: CompletedActorContext,
  payload: ContestCreate
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.contest.findUnique({
      where: { slug: payload.slug }
    });

    if (existing) {
      throw new ConflictError(`Contest slug already exists: ${payload.slug}`);
    }

    await ensureUser(tx, actor.userId, actor);

    const courseId = payload.courseSlug
      ? (await requireCourse(tx, payload.courseSlug)).id
      : null;

    const contest = await tx.contest.create({
      data: {
        courseId,
        endsAt: new Date(payload.endsAt),
        frozenAt: payload.frozenAt ? new Date(payload.frozenAt) : null,
        scoringMode: payload.scoringMode,
        slug: payload.slug,
        startsAt: new Date(payload.startsAt),
        submitCooldownSec: payload.submitCooldownSec,
        summary: payload.summary,
        title: payload.title,
        visibility: "published"
      }
    });

    await resolveAndAttachContestProblems(tx, contest.id, payload.problemSlugs);

    return contest;
  });
}

// ─── Contest update ─────────────────────────────────────────────────

export async function updateContestRecord(
  actor: CompletedActorContext,
  contestSlug: string,
  payload: ContestUpdate
) {
  return prisma.$transaction(async (tx) => {
    const contest = await requireContest(tx, contestSlug);

    const updateData: Prisma.ContestUncheckedUpdateInput = {};
    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.summary !== undefined) updateData.summary = payload.summary;
    if (payload.startsAt !== undefined) updateData.startsAt = new Date(payload.startsAt);
    if (payload.endsAt !== undefined) updateData.endsAt = new Date(payload.endsAt);
    if (payload.scoringMode !== undefined) updateData.scoringMode = payload.scoringMode;
    if (payload.submitCooldownSec !== undefined)
      updateData.submitCooldownSec = payload.submitCooldownSec;
    if (payload.frozenAt !== undefined)
      updateData.frozenAt = payload.frozenAt ? new Date(payload.frozenAt) : null;

    if (payload.courseSlug !== undefined) {
      updateData.courseId = payload.courseSlug
        ? (await requireCourse(tx, payload.courseSlug)).id
        : null;
    }

    if (Object.keys(updateData).length > 0) {
      await tx.contest.update({
        data: updateData,
        where: { id: contest.id }
      });
    }

    // Replace problems if provided
    if (payload.problemSlugs !== undefined) {
      await tx.contestProblem.deleteMany({
        where: { contestId: contest.id }
      });

      await resolveAndAttachContestProblems(tx, contest.id, payload.problemSlugs);
    }

    return { id: contest.id };
  });
}
