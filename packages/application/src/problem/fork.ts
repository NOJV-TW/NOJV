import {
  courseMembershipRepo,
  Prisma,
  problemRepo,
  runTransaction,
  submissionRepo,
  type TransactionClient,
} from "@nojv/db";
import type { PlatformRole } from "@nojv/core";

import { ForbiddenError, NotFoundError } from "../shared/errors";

import type { ProblemActorContext } from "./permissions";

export interface ForkOptions {
  authorId: string;
  published: boolean;
}

function nullableJson(
  value: Prisma.JsonValue | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ?? Prisma.DbNull;
}

function requiredJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function forkProblemInTransaction(
  tx: TransactionClient,
  sourceProblemId: string,
  options: ForkOptions,
) {
  await problemRepo.withTx(tx).lockForUpdate(sourceProblemId);
  const source = await tx.problem.findUnique({
    where: { id: sourceProblemId },
    include: {
      referenceSolutionSubmission: true,
      statement: true,
      testcaseSets: {
        include: { testcases: { orderBy: { ordinal: "asc" } } },
        orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }],
      },
      workspaceFiles: {
        orderBy: [{ language: "asc" }, { orderIndex: "asc" }, { path: "asc" }],
      },
    },
  });
  if (!source) throw new NotFoundError(`Problem not found: ${sourceProblemId}`);

  let displayId: number | null = null;
  if (options.published) {
    await problemRepo.withTx(tx).acquireDisplayIdLock();
    const maximum = await problemRepo.withTx(tx).maxDisplayId();
    displayId = (maximum._max.displayId ?? 0) + 1;
  }

  const fork = await tx.problem.create({
    data: {
      activeStorageBytes: source.activeStorageBytes,
      adminMayPublish: false,
      advancedConfig: nullableJson(source.advancedConfig),
      advancedRequiredPaths: source.advancedRequiredPaths,
      authorId: options.authorId,
      checkerStorage: nullableJson(source.checkerStorage),
      difficulty: source.difficulty,
      displayId,
      forkedFromProblemId: source.id,
      interactorStorage: nullableJson(source.interactorStorage),
      judgeConfig: nullableJson(source.judgeConfig),
      memoryLimitMb: source.memoryLimitMb,
      samples: nullableJson(source.samples),
      status: options.published ? "published" : "draft",
      storageGeneration: source.storageGeneration,
      tags: source.tags,
      timeLimitMs: source.timeLimitMs,
      title: source.title,
      type: source.type,
      visibility: options.published ? "public" : "private",
    },
  });

  if (source.statement) {
    await tx.problemStatement.create({
      data: {
        bodyMarkdown: source.statement.bodyMarkdown,
        inputFormat: source.statement.inputFormat,
        outputFormat: source.statement.outputFormat,
        problemId: fork.id,
      },
    });
  }

  for (const testcaseSet of source.testcaseSets) {
    const copiedSet = await tx.testcaseSet.create({
      data: {
        description: testcaseSet.description,
        name: testcaseSet.name,
        ordinal: testcaseSet.ordinal,
        problemId: fork.id,
        weight: testcaseSet.weight,
      },
    });
    if (testcaseSet.testcases.length > 0) {
      await tx.testcase.createMany({
        data: testcaseSet.testcases.map((testcase) => ({
          inputFileStorage: nullableJson(testcase.inputFileStorage),
          inputStorage: requiredJson(testcase.inputStorage),
          ordinal: testcase.ordinal,
          outputStorage: nullableJson(testcase.outputStorage),
          testcaseSetId: copiedSet.id,
        })),
      });
    }
  }

  if (source.workspaceFiles.length > 0) {
    await tx.problemWorkspaceFile.createMany({
      data: source.workspaceFiles.map((file) => ({
        contentStorage: requiredJson(file.contentStorage),
        description: file.description,
        language: file.language,
        orderIndex: file.orderIndex,
        path: file.path,
        problemId: fork.id,
        visibility: file.visibility,
      })),
    });
  }

  const reference = source.referenceSolutionSubmission;
  if (
    reference?.status === "accepted" &&
    reference.isReferenceSolution &&
    !reference.sampleOnly &&
    reference.sourceStorage !== null &&
    reference.referenceProblemStorageGeneration === source.storageGeneration
  ) {
    const copiedReference = await submissionRepo.withTx(tx).create({
      context: { type: "practice" },
      activeJudgeRunId: null,
      advancedConfigSnapshot: nullableJson(reference.advancedConfigSnapshot),
      isReferenceSolution: true,
      judgeGeneration: reference.judgeGeneration,
      language: reference.language,
      memoryKb: reference.memoryKb,
      problemId: fork.id,
      referenceProblemStorageGeneration: fork.storageGeneration,
      runtimeMs: reference.runtimeMs,
      sampleOnly: false,
      score: reference.score,
      sourceStorage: requiredJson(reference.sourceStorage),
      status: "accepted",
      userId: options.authorId,
      verdictDetailStorage: nullableJson(reference.verdictDetailStorage),
      verdictSummary: nullableJson(reference.verdictSummary),
    });
    await tx.problem.update({
      where: { id: fork.id },
      data: { referenceSolutionSubmissionId: copiedReference.id },
    });
  }

  return fork;
}

function canManuallyFork(platformRole: PlatformRole): boolean {
  return platformRole === "teacher" || platformRole === "admin";
}

export async function canForkProblems(actor: {
  platformRole: PlatformRole;
  userId: string;
}): Promise<boolean> {
  return (
    canManuallyFork(actor.platformRole) ||
    (await courseMembershipRepo.hasActiveStaffMembership(actor.userId))
  );
}

export async function forkProblemRecord(actor: ProblemActorContext, sourceProblemId: string) {
  if (!(await canForkProblems(actor))) {
    throw new ForbiddenError("Only teachers, admins, and active course TAs can fork problems.");
  }

  return runTransaction(async (tx) => {
    const source = await problemRepo.withTx(tx).findById(sourceProblemId);
    if (!source) throw new NotFoundError(`Problem not found: ${sourceProblemId}`);
    if (source.visibility !== "public" || source.status !== "published") {
      throw new ForbiddenError("Only published public problems can be forked.");
    }
    return forkProblemInTransaction(tx, source.id, {
      authorId: actor.userId,
      published: false,
    });
  });
}

export async function resolveActivityProblems(
  tx: TransactionClient,
  actor: ProblemActorContext,
  problemIds: readonly string[],
) {
  if (problemIds.length === 0) return [];
  const found = await problemRepo.withTx(tx).findMany({ id: { in: [...problemIds] } });
  const byId = new Map(found.map((problem) => [problem.id, problem]));
  const resolved = [];

  for (const id of problemIds) {
    const problem = byId.get(id);
    if (!problem) throw new NotFoundError(`Problem not found: ${id}`);
    if (problem.authorId === actor.userId) {
      resolved.push(problem);
      continue;
    }
    if (problem.visibility !== "public" || problem.status !== "published") {
      throw new ForbiddenError("Private problems can only be attached by their author.");
    }
    resolved.push(
      await forkProblemInTransaction(tx, problem.id, {
        authorId: actor.userId,
        published: false,
      }),
    );
  }

  return resolved;
}
