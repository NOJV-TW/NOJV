import { isDeepStrictEqual } from "node:util";
import {
  Prisma,
  problemRepo,
  problemStatementRepo,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";
import {
  submissionResultVerdicts,
  type AdvancedConfig,
  type ProblemCreate,
  type ProblemDifficulty,
  type ProblemStatus,
  type ProblemType,
  type ProblemUpdate,
  type ProblemVisibility,
} from "@nojv/core";
import { assertStorageObjectPointer } from "@nojv/storage";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors";
import { requireUser } from "../../shared/require";
import { commitStoragePointerSwap } from "../../shared/storage-object-lifecycle";
import {
  assertCanCreateAdvancedProblems,
  canPublishPublicProblems,
  assertProblemOwnership,
  lockProblemForEdit,
  type ProblemActorContext,
} from "../permissions";
import { forkProblemInTransaction } from "../fork";
import { assertProblemPublishable } from "./publishing";
import { problemStoragePointers } from "./storage-pointers";

export interface CreateProblemDefinitionInput {
  authorId: string;
  difficulty?: ProblemDifficulty | undefined;
  inputFormat?: string | undefined;
  judgeConfig?: unknown;
  memoryLimitMb?: number | undefined;
  outputFormat?: string | undefined;
  statement?: string | undefined;
  status?: ProblemStatus | undefined;
  tags?: string[] | undefined;
  timeLimitMs?: number | undefined;
  title: string;
  visibility?: ProblemVisibility | undefined;
  type?: ProblemType | undefined;
  advancedConfig?: AdvancedConfig | undefined;
  adminMayPublish?: boolean | undefined;
}

export async function createProblemDefinition(
  tx: TransactionClient,
  input: CreateProblemDefinitionInput,
) {
  const type: ProblemType = input.type ?? "full_source";

  const createData: Prisma.ProblemUncheckedCreateInput = {
    authorId: input.authorId,
    title: input.title,
    difficulty: input.difficulty ?? "medium",
    memoryLimitMb: input.memoryLimitMb ?? 256,
    samples: Prisma.JsonNull,
    status: input.status ?? "draft",
    tags: input.tags ?? [],
    timeLimitMs: input.timeLimitMs ?? 1_000,
    type,
    visibility: input.visibility ?? "public",
    adminMayPublish: input.adminMayPublish ?? false,
  };
  if (input.judgeConfig !== undefined) {
    createData.judgeConfig = input.judgeConfig as Prisma.InputJsonValue;
  }
  if (type === "special_env" && input.advancedConfig !== undefined) {
    createData.advancedConfig = input.advancedConfig;
  }
  const problem = await problemRepo.withTx(tx).create(createData);

  if (input.statement) {
    await problemStatementRepo.withTx(tx).create({
      bodyMarkdown: input.statement,
      inputFormat: input.inputFormat ?? "",
      outputFormat: input.outputFormat ?? "",
      problemId: problem.id,
    });
  }

  return problem;
}

export async function deleteProblemRecord(actor: ProblemActorContext, problemId: string) {
  return runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await tx.problem.findUnique({
      where: { id: problemId },
      include: {
        workspaceFiles: true,
        testcaseSets: { include: { testcases: true } },
      },
    });
    if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
    assertProblemOwnership(problem, actor);
    if (problem.status !== "draft") {
      throw new ConflictError("Only draft problems can be deleted.");
    }
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE "problemId" = ${problemId} ORDER BY id FOR UPDATE`;
    const linked = await tx.problem.findFirst({
      where: {
        id: problemId,
        OR: [
          { contestLinks: { some: {} } },
          { examLinks: { some: {} } },
          { assessmentLinks: { some: {} } },
          { courseLinks: { some: {} } },
          {
            submissions: {
              some: {
                NOT: {
                  isReferenceSolution: true,
                  sampleOnly: false,
                  status: { in: [...submissionResultVerdicts] },
                  courseId: null,
                  assessmentId: null,
                  examId: null,
                  contestId: null,
                  participationId: null,
                },
              },
            },
          },
          { posts: { some: {} } },
          { scoreOverrides: { some: {} } },
          { submissionFeedback: { some: {} } },
        ],
      },
      select: { id: true },
    });
    if (linked) {
      throw new ConflictError(
        "This problem is used in a contest, exam, or assignment and cannot be deleted. Remove it from those first.",
      );
    }
    const [scoreAudit, feedbackAudit] = await Promise.all([
      tx.scoreOverrideAuditLog.findFirst({
        where: { problemId },
        select: { id: true },
      }),
      tx.submissionFeedbackAuditLog.findFirst({
        where: { problemId },
        select: { id: true },
      }),
    ]);
    if (scoreAudit || feedbackAudit) {
      throw new ConflictError("Problems with historical grading records cannot be deleted.");
    }
    const activeJudge = await tx.judgeExecution.findFirst({
      where: {
        submission: { problemId },
        OR: [{ state: { notIn: ["completed", "cancelled"] } }, { leaseToken: { not: null } }],
      },
      select: { id: true },
    });
    if (activeJudge)
      throw new ConflictError(
        "This problem still has active judge executions or sandbox cleanup.",
      );
    const references = await tx.submission.findMany({
      where: { problemId },
      select: {
        sourceStorage: true,
        verdictDetailStorage: true,
        judgeExecutions: { select: { snapshot: true, stages: { select: { result: true } } } },
      },
    });
    const removed = [
      ...problemStoragePointers(problem),
      ...references.flatMap(({ sourceStorage, verdictDetailStorage, judgeExecutions }) =>
        [
          sourceStorage,
          verdictDetailStorage,
          ...judgeExecutions.flatMap((run) => [
            run.snapshot,
            ...run.stages.map((stage) => stage.result),
          ]),
        ]
          .filter((pointer) => pointer !== null)
          .map(assertStorageObjectPointer),
      ),
    ];
    const deleted = await tx.problem.delete({ where: { id: problemId } });
    await commitStoragePointerSwap(tx, { added: [], removed });
    return deleted;
  });
}

export async function createProblemRecord(actor: ProblemActorContext, payload: ProblemCreate) {
  if (
    actor.platformRole === "student" &&
    (payload.visibility === "public" || payload.status === "published")
  ) {
    throw new ForbiddenError("Students can only create private draft problems.");
  }
  if (payload.type === "special_env") {
    await assertCanCreateAdvancedProblems(actor);
  }
  return runTransaction(async (tx) => {
    const author = await requireUser(tx, actor.userId);
    const visibility = actor.platformRole === "student" ? "private" : payload.visibility;

    const problem = await createProblemDefinition(tx, {
      advancedConfig: payload.advancedConfig,
      adminMayPublish: visibility === "private" ? payload.adminMayPublish : false,
      authorId: author.id,
      difficulty: payload.difficulty,
      inputFormat: payload.inputFormat,
      judgeConfig: payload.judgeConfig,
      memoryLimitMb: payload.memoryLimitMb,
      outputFormat: payload.outputFormat,
      statement: payload.statement,
      status: actor.platformRole === "student" ? "draft" : payload.status,
      tags: payload.tags,
      timeLimitMs: payload.timeLimitMs,
      title: payload.title,
      type: payload.type,
      visibility,
    });

    return problem;
  });
}

function buildProblemUpdateData(payload: ProblemUpdate): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (payload.title !== undefined) updateData.title = payload.title;
  if (payload.visibility !== undefined) updateData.visibility = payload.visibility;
  if (payload.timeLimitMs !== undefined) updateData.timeLimitMs = payload.timeLimitMs;
  if (payload.memoryLimitMb !== undefined) updateData.memoryLimitMb = payload.memoryLimitMb;
  if (payload.judgeConfig !== undefined) updateData.judgeConfig = payload.judgeConfig;
  if (payload.status !== undefined) updateData.status = payload.status;
  if (payload.type !== undefined) updateData.type = payload.type;
  if (payload.samples !== undefined) updateData.samples = payload.samples;
  if (payload.advancedConfig !== undefined) updateData.advancedConfig = payload.advancedConfig;
  if (payload.visibility === "public") updateData.adminMayPublish = false;
  else if (payload.adminMayPublish !== undefined)
    updateData.adminMayPublish = payload.adminMayPublish;
  if (payload.difficulty !== undefined) updateData.difficulty = payload.difficulty;
  if (payload.tags !== undefined) updateData.tags = payload.tags;
  return updateData;
}

function assertSpecialEnvImageConsistency(
  payload: ProblemUpdate,
  problem: {
    type: ProblemType;
    advancedConfig: unknown;
  },
): void {
  const mergedType = payload.type ?? problem.type;
  const mergedConfig = payload.advancedConfig ?? problem.advancedConfig;
  const hasConfig = mergedConfig != null;
  if (mergedType === "special_env" && !hasConfig) {
    throw new ValidationError("special_env problems require advancedConfig.");
  }
  if (mergedType !== "special_env" && hasConfig) {
    throw new ValidationError("advancedConfig is only allowed on special_env problems.");
  }
}

export async function updateProblemRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemUpdate,
) {
  return runTransaction(async (tx) => {
    const problem = await lockProblemForEdit(tx, actor, problemId);
    if ((payload.type ?? problem.type) === "special_env") {
      await assertCanCreateAdvancedProblems(actor);
    }

    const effectiveVisibility = payload.visibility ?? problem.visibility;
    const publishesFork = problem.visibility === "private" && effectiveVisibility === "public";
    if (payload.visibility !== undefined && payload.visibility !== problem.visibility) {
      assertProblemOwnership(problem, actor);
    }
    if (effectiveVisibility === "public" && !(await canPublishPublicProblems(actor))) {
      throw new ForbiddenError(
        "Public problems can only be published by teachers, admins, or active course TAs.",
      );
    }
    if (publishesFork && problem.authorId !== actor.userId && !problem.adminMayPublish) {
      throw new ConflictError("The author has not allowed an admin to publish this problem.");
    }
    const consentChanged =
      payload.adminMayPublish !== undefined &&
      payload.adminMayPublish !== problem.adminMayPublish;
    if (consentChanged && problem.authorId !== actor.userId) {
      throw new ForbiddenError(
        "Only the problem author can change admin publication permission.",
      );
    }
    if (consentChanged && payload.adminMayPublish && effectiveVisibility !== "private") {
      throw new ConflictError(
        "Admin publication permission is only available for private problems.",
      );
    }

    if (
      problem.status === "published" &&
      problem.type === "special_env" &&
      ((payload.advancedConfig !== undefined &&
        !isDeepStrictEqual(payload.advancedConfig, problem.advancedConfig)) ||
        (payload.timeLimitMs !== undefined && payload.timeLimitMs !== problem.timeLimitMs) ||
        (payload.memoryLimitMb !== undefined &&
          payload.memoryLimitMb !== problem.memoryLimitMb))
    ) {
      throw new ConflictError(
        "Published Advanced-mode judge configuration and resource limits cannot be changed.",
      );
    }

    if (
      problem.status === "published" &&
      payload.type !== undefined &&
      payload.type !== problem.type
    ) {
      throw new ConflictError("Published problems cannot change type.");
    }

    if (
      payload.advancedConfig !== undefined &&
      !isDeepStrictEqual(payload.advancedConfig, problem.advancedConfig)
    ) {
      throw new ConflictError("Use the Advanced judge configuration action to change images.");
    }

    if (payload.status === "draft" && problem.status === "published") {
      throw new ConflictError("Published problems cannot be reverted to draft.");
    }

    const judgeConfigurationChanged =
      (payload.judgeConfig !== undefined &&
        !isDeepStrictEqual(payload.judgeConfig, problem.judgeConfig)) ||
      (payload.type !== undefined && payload.type !== problem.type) ||
      (payload.timeLimitMs !== undefined && payload.timeLimitMs !== problem.timeLimitMs) ||
      (payload.memoryLimitMb !== undefined && payload.memoryLimitMb !== problem.memoryLimitMb);

    if (publishesFork || (payload.status === "published" && problem.status !== "published")) {
      await assertProblemPublishable(tx, {
        ...problem,
        type: payload.type ?? problem.type,
        title: payload.title ?? problem.title,
        advancedConfig: payload.advancedConfig ?? problem.advancedConfig,
        timeLimitMs: payload.timeLimitMs ?? problem.timeLimitMs,
        memoryLimitMb: payload.memoryLimitMb ?? problem.memoryLimitMb,
        referenceSolutionSubmissionId: judgeConfigurationChanged
          ? null
          : problem.referenceSolutionSubmissionId,
      });
    }

    const updateData = buildProblemUpdateData(payload);
    if (!consentChanged) delete updateData.adminMayPublish;

    if (judgeConfigurationChanged) {
      updateData.referenceSolutionSubmissionId = null;
      updateData.storageGeneration = { increment: 1 };
    }

    assertSpecialEnvImageConsistency(payload, problem);

    const target = publishesFork
      ? await forkProblemInTransaction(tx, problem.id, {
          authorId: actor.userId,
          published: true,
          requirePublishedPublicSource: false,
        })
      : problem;
    if (publishesFork) {
      updateData.status = "published";
      updateData.adminMayPublish = false;
      if (problem.authorId !== actor.userId) {
        await problemRepo.withTx(tx).update(problem.id, { adminMayPublish: false });
      }
    }

    if (
      !publishesFork &&
      payload.status === "published" &&
      problem.status !== "published" &&
      problem.displayId == null
    ) {
      await problemRepo.withTx(tx).acquireDisplayIdLock();
      const agg = await problemRepo.withTx(tx).maxDisplayId();
      updateData.displayId = (agg._max.displayId ?? 0) + 1;
    }

    if (Object.keys(updateData).length > 0) {
      await problemRepo.withTx(tx).update(target.id, updateData);
    }

    if (
      payload.statement !== undefined ||
      payload.inputFormat !== undefined ||
      payload.outputFormat !== undefined
    ) {
      await problemStatementRepo.withTx(tx).upsert(
        target.id,
        {
          bodyMarkdown: payload.statement ?? "",
          inputFormat: payload.inputFormat ?? "",
          outputFormat: payload.outputFormat ?? "",
          problemId: target.id,
        },
        {
          ...(payload.statement !== undefined ? { bodyMarkdown: payload.statement } : {}),
          ...(payload.inputFormat !== undefined ? { inputFormat: payload.inputFormat } : {}),
          ...(payload.outputFormat !== undefined ? { outputFormat: payload.outputFormat } : {}),
        },
      );
    }

    return { id: target.id };
  });
}
