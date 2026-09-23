import { isDeepStrictEqual } from "node:util";
import {
  problemRepo,
  runTransaction,
  submissionRepo,
  testcaseSetRepo,
  userRepo,
  type TransactionClient,
} from "@nojv/db";
import {
  advancedConfigSchema,
  advancedJudgeVerificationSnapshotSchema,
  requiredPathsSchema,
  userHandleSchema,
  type AdvancedJudgeVerificationSnapshot,
  type ProblemType,
} from "@nojv/core";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors";
import { requireProblem, requireUser } from "../../shared/require";
import {
  assertProblemOwnership,
  lockProblemForEdit,
  type ProblemActorContext,
} from "../permissions";
import { forkProblemInTransaction } from "../fork";

export async function hasVerifiedAdvancedJudgeRun(
  problemId: string,
  advancedConfig: unknown,
  requiredPaths: unknown,
  resourceLimits: { totalTimeMs: number; memoryMb: number },
): Promise<boolean> {
  const current = advancedConfigSchema.safeParse(advancedConfig);
  const currentRequiredPaths = requiredPathsSchema.safeParse(requiredPaths);
  if (!current.success || !currentRequiredPaths.success) return false;
  const currentSnapshot: AdvancedJudgeVerificationSnapshot = {
    config: current.data,
    requiredPaths: currentRequiredPaths.data,
    resourceLimits,
  };

  const rows = await submissionRepo.findMany({
    where: { problemId, status: "accepted" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { advancedConfigSnapshot: true },
  });

  return rows.some((row) => {
    const snapshot = advancedJudgeVerificationSnapshotSchema.safeParse(
      row.advancedConfigSnapshot,
    );
    if (!snapshot.success) return false;
    return isDeepStrictEqual(snapshot.data, currentSnapshot);
  });
}

export async function assertProblemPublishable(
  tx: TransactionClient,
  problem: {
    id: string;
    type: ProblemType;
    title: string;
    advancedConfig: unknown;
    advancedRequiredPaths: unknown;
    timeLimitMs: number;
    memoryLimitMb: number;
    storageGeneration: number;
    referenceSolutionSubmissionId: string | null;
  },
): Promise<void> {
  if (problem.type === "special_env") {
    if (problem.title.trim() === "" || problem.title === "Untitled Problem") {
      throw new ConflictError("Advanced-mode problems require a title before publishing.");
    }
    if (!advancedConfigSchema.safeParse(problem.advancedConfig).success) {
      throw new ConflictError(
        "Advanced-mode problems require run and grade images before publishing.",
      );
    }
    if (
      !(await hasVerifiedAdvancedJudgeRun(
        problem.id,
        problem.advancedConfig,
        problem.advancedRequiredPaths,
        { totalTimeMs: problem.timeLimitMs, memoryMb: problem.memoryLimitMb },
      ))
    ) {
      throw new ConflictError(
        "Advanced-mode problems require an accepted test run with the current images before publishing.",
      );
    }
    return;
  }

  const testcaseSetCount = await testcaseSetRepo.withTx(tx).countByProblem(problem.id);
  if (testcaseSetCount === 0) {
    throw new ConflictError("Problems require at least one testcase set before publishing.");
  }
  if (!problem.referenceSolutionSubmissionId) {
    throw new ConflictError(
      "Problems require an accepted reference solution before publishing.",
    );
  }
  const reference = await tx.submission.findUnique({
    where: { id: problem.referenceSolutionSubmissionId },
    select: {
      assessmentId: true,
      contestId: true,
      courseId: true,
      examId: true,
      isReferenceSolution: true,
      participationId: true,
      problemId: true,
      referenceProblemStorageGeneration: true,
      sampleOnly: true,
      sourceStorage: true,
      status: true,
    },
  });
  if (
    reference?.problemId !== problem.id ||
    !reference.isReferenceSolution ||
    reference.status !== "accepted" ||
    reference.sampleOnly ||
    reference.sourceStorage === null ||
    reference.assessmentId !== null ||
    reference.contestId !== null ||
    reference.courseId !== null ||
    reference.examId !== null ||
    reference.participationId !== null ||
    reference.referenceProblemStorageGeneration !== problem.storageGeneration
  ) {
    throw new ConflictError(
      "Problems require an accepted reference solution for the current judge configuration.",
    );
  }
}

export async function publishProblemAsAdmin(actor: ProblemActorContext, problemId: string) {
  if (actor.platformRole !== "admin") {
    throw new ForbiddenError("Only admins can publish another author's problem.");
  }

  return runTransaction(async (tx) => {
    const problem = await lockProblemForEdit(tx, actor, problemId);
    if (problem.visibility === "public") {
      if (problem.status === "published") return { id: problem.id };
      await assertProblemPublishable(tx, problem);
      await problemRepo.withTx(tx).acquireDisplayIdLock();
      const maximum = await problemRepo.withTx(tx).maxDisplayId();
      await problemRepo.withTx(tx).update(problem.id, {
        status: "published",
        adminMayPublish: false,
        displayId: problem.displayId ?? (maximum._max.displayId ?? 0) + 1,
      });
      return { id: problem.id };
    }
    if (problem.authorId !== actor.userId && !problem.adminMayPublish) {
      throw new ConflictError("The author has not allowed an admin to publish this problem.");
    }

    await assertProblemPublishable(tx, problem);
    const publishedFork = await forkProblemInTransaction(tx, problem.id, {
      authorId: actor.userId,
      published: true,
      requirePublishedPublicSource: false,
    });
    if (problem.authorId !== actor.userId) {
      await problemRepo.withTx(tx).update(problem.id, { adminMayPublish: false });
    }
    return { id: publishedFork.id };
  });
}

export async function transferProblemOwnership(
  actor: ProblemActorContext,
  problemId: string,
  targetUsername: string,
): Promise<{ id: string; authorId: string }> {
  const parsed = userHandleSchema.safeParse(targetUsername);
  if (!parsed.success) throw new ValidationError("Invalid owner username.");
  return runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
    const candidate = await userRepo.withTx(tx).findByUsername(parsed.data);
    if (!candidate) throw new NotFoundError("The new owner must be an existing user.");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.id} FOR SHARE`;
    const target = await requireUser(tx, candidate.id);
    if (target.disabled || target.username !== parsed.data) {
      throw new ConflictError("The new owner must be an available user with that username.");
    }
    if (problem.authorId !== target.id) {
      await problemRepo.withTx(tx).update(problem.id, {
        authorId: target.id,
        adminMayPublish: false,
      });
    }
    return { id: problem.id, authorId: target.id };
  });
}
