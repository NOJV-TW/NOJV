import { isDeepStrictEqual } from "node:util";

import {
  Prisma,
  problemRepo,
  problemStatementRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  submissionRepo,
  testcaseSetRepo,
  type TransactionClient,
} from "@nojv/db";
import type {
  AdvancedConfig,
  AdvancedJudgeConfiguration,
  AdvancedJudgeVerificationSnapshot,
  JudgeConfig,
  JudgeScriptLanguage,
  ProblemCreate,
  ProblemDifficulty,
  ProblemStatus,
  ProblemType,
  ProblemUpdate,
  ProblemVisibility,
} from "@nojv/core";
import { assertStorageObjectPointer, type StorageObjectPointer } from "@nojv/storage";
import {
  advancedConfigSchema,
  advancedJudgeVerificationSnapshotSchema,
  judgeConfigSchema,
  requiredPathsSchema,
} from "@nojv/core";

import { ConflictError, NotFoundError, ValidationError } from "../shared/errors";
import { requireProblem } from "../shared/require";
import { commitStoragePointerSwap } from "../shared/storage-object-lifecycle";
import { ensureUser } from "../user/mutations";

import { writeCheckerScriptBlob, writeInteractorScriptBlob } from "./blobs";
import {
  assertCanCreateAdvancedProblems,
  assertProblemEditAccess,
  assertProblemOwnership,
  type ProblemActorContext,
} from "./permissions";

export interface CreateProblemDefinitionInput {
  authorId?: string | undefined;
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
}

export async function createProblemDefinition(
  tx: TransactionClient,
  input: CreateProblemDefinitionInput,
) {
  const type: ProblemType = input.type ?? "full_source";

  const createData: Prisma.ProblemUncheckedCreateInput = {
    authorId: input.authorId ?? null,
    title: input.title,
    difficulty: input.difficulty ?? "medium",
    memoryLimitMb: input.memoryLimitMb ?? 256,
    samples: Prisma.JsonNull,
    status: input.status ?? "draft",
    tags: input.tags ?? [],
    timeLimitMs: input.timeLimitMs ?? 1_000,
    type,
    visibility: input.visibility ?? "public",
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
    const linked = await tx.problem.findFirst({
      where: {
        id: problemId,
        OR: [
          { contestLinks: { some: {} } },
          { examLinks: { some: {} } },
          { assessmentLinks: { some: {} } },
        ],
      },
      select: { id: true },
    });
    if (linked) {
      throw new ConflictError(
        "This problem is used in a contest, exam, or assignment and cannot be deleted. Remove it from those first.",
      );
    }
    const removed = problemStoragePointers(problem);
    const deleted = await tx.problem.delete({ where: { id: problemId } });
    await commitStoragePointerSwap(tx, { added: [], removed });
    return deleted;
  });
}

export async function createProblemRecord(actor: ProblemActorContext, payload: ProblemCreate) {
  if (payload.type === "special_env") {
    await assertCanCreateAdvancedProblems(actor);
  }
  return runTransaction(async (tx) => {
    const author = await ensureUser(tx, actor.userId, actor);

    const problem = await createProblemDefinition(tx, {
      advancedConfig: payload.advancedConfig,
      authorId: author.id,
      difficulty: payload.difficulty,
      inputFormat: payload.inputFormat,
      judgeConfig: payload.judgeConfig,
      memoryLimitMb: payload.memoryLimitMb,
      outputFormat: payload.outputFormat,
      statement: payload.statement,
      status: payload.status,
      tags: payload.tags,
      timeLimitMs: payload.timeLimitMs,
      title: payload.title,
      type: payload.type,
      visibility: payload.visibility,
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

async function assertProblemPublishable(
  tx: TransactionClient,
  problem: {
    id: string;
    type: ProblemType;
    title: string;
    advancedConfig: unknown;
    advancedRequiredPaths: unknown;
    timeLimitMs: number;
    memoryLimitMb: number;
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
}

export async function updateProblemRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemUpdate,
) {
  return runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);

    assertProblemOwnership(problem, actor);

    if (
      problem.status === "published" &&
      problem.type === "special_env" &&
      (payload.advancedConfig !== undefined ||
        payload.timeLimitMs !== undefined ||
        payload.memoryLimitMb !== undefined)
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

    const becomesSpecialEnv =
      (payload.type ?? problem.type) === "special_env" && problem.type !== "special_env";
    if (becomesSpecialEnv || payload.advancedConfig !== undefined) {
      await assertCanCreateAdvancedProblems(actor);
    }

    if (payload.status === "draft" && problem.status === "published") {
      throw new ConflictError("Published problems cannot be reverted to draft.");
    }

    if (payload.status === "published" && problem.status !== "published") {
      await assertProblemPublishable(tx, {
        ...problem,
        type: payload.type ?? problem.type,
        title: payload.title ?? problem.title,
        advancedConfig: payload.advancedConfig ?? problem.advancedConfig,
        timeLimitMs: payload.timeLimitMs ?? problem.timeLimitMs,
        memoryLimitMb: payload.memoryLimitMb ?? problem.memoryLimitMb,
      });
    }

    const updateData = buildProblemUpdateData(payload);

    assertSpecialEnvImageConsistency(payload, problem);

    if (
      payload.status === "published" &&
      problem.status !== "published" &&
      problem.displayId == null
    ) {
      await problemRepo.withTx(tx).acquireDisplayIdLock();
      const agg = await problemRepo.withTx(tx).maxDisplayId();
      updateData.displayId = (agg._max.displayId ?? 0) + 1;
    }

    if (Object.keys(updateData).length > 0) {
      await problemRepo.withTx(tx).update(problem.id, updateData);
    }

    if (
      payload.statement !== undefined ||
      payload.inputFormat !== undefined ||
      payload.outputFormat !== undefined
    ) {
      await problemStatementRepo.withTx(tx).upsert(
        problem.id,
        {
          bodyMarkdown: payload.statement ?? "",
          inputFormat: payload.inputFormat ?? "",
          outputFormat: payload.outputFormat ?? "",
          problemId: problem.id,
        },
        {
          ...(payload.statement !== undefined ? { bodyMarkdown: payload.statement } : {}),
          ...(payload.inputFormat !== undefined ? { inputFormat: payload.inputFormat } : {}),
          ...(payload.outputFormat !== undefined ? { outputFormat: payload.outputFormat } : {}),
        },
      );
    }

    return { id: problem.id };
  });
}

export interface SaveJudgeConfigInput {
  judgeConfig: JudgeConfig;
  checkerScript?: string | undefined;
  interactorScript?: string | undefined;
}

export async function saveProblemJudgeConfig(
  actor: ProblemActorContext,
  problemId: string,
  input: SaveJudgeConfigInput,
): Promise<{ id: string }> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  assertProblemOwnership(problem, actor);

  const { type } = input.judgeConfig;
  const checkerBody =
    type === "checker" && (input.checkerScript ?? "").trim() ? input.checkerScript : null;
  const interactorBody =
    type === "interactive" && (input.interactorScript ?? "").trim()
      ? input.interactorScript
      : null;

  const checkerStorage =
    checkerBody == null ? null : await writeCheckerScriptBlob(problemId, checkerBody);
  const interactorStorage =
    interactorBody == null ? null : await writeInteractorScriptBlob(problemId, interactorBody);

  const judgeConfig: JudgeConfig = {
    type,
    ...(checkerStorage ? { checkerLanguage: input.judgeConfig.checkerLanguage } : {}),
    ...(interactorStorage ? { interactorLanguage: input.judgeConfig.interactorLanguage } : {}),
    ...(type === "standard" && input.judgeConfig.compare
      ? { compare: input.judgeConfig.compare }
      : {}),
    ...(input.judgeConfig.runtime ? { runtime: input.judgeConfig.runtime } : {}),
  };

  return runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const current = await requireProblem(tx, problemId);
    assertProblemOwnership(current, actor);
    const previousBytes =
      optionalPointerSize(current.checkerStorage) +
      optionalPointerSize(current.interactorStorage);
    const nextBytes = (checkerStorage?.size ?? 0) + (interactorStorage?.size ?? 0);
    await problemRepo.withTx(tx).update(problemId, {
      judgeConfig,
      checkerStorage: checkerStorage ?? Prisma.DbNull,
      interactorStorage: interactorStorage ?? Prisma.DbNull,
      activeStorageBytes: { increment: nextBytes - previousBytes },
      storageGeneration: { increment: 1 },
    });
    await commitStoragePointerSwap(tx, {
      added: [checkerStorage, interactorStorage].filter(
        (pointer): pointer is StorageObjectPointer => pointer !== null,
      ),
      removed: [current.checkerStorage, current.interactorStorage]
        .filter((pointer) => pointer !== null)
        .map(assertStorageObjectPointer),
    });
    return { id: problemId };
  });
}

export async function updateAdvancedJudgeConfiguration(
  actor: ProblemActorContext,
  problemId: string,
  input: AdvancedJudgeConfiguration,
): Promise<void> {
  await assertCanCreateAdvancedProblems(actor);
  await runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    if (problem.status === "published") {
      throw new ConflictError("Published Advanced-mode judge configuration cannot be changed.");
    }
    if (problem.type !== "special_env") {
      throw new ConflictError(
        "Advanced judge configuration requires an Advanced-mode problem.",
      );
    }

    await problemRepo.withTx(tx).update(problem.id, {
      advancedConfig: input.config,
      advancedRequiredPaths: input.requiredPaths,
    });
  });
}

export async function convertProblemToAdvancedMode(
  actor: ProblemActorContext,
  problemId: string,
): Promise<void> {
  await assertCanCreateAdvancedProblems(actor);
  await runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    if (problem.status !== "draft") {
      throw new ConflictError("Only draft problems can be converted to Advanced Mode.");
    }

    if (problem.type === "special_env") {
      throw new ConflictError("Problem is already a special_env problem.");
    }

    const [workspaceFiles, testcaseSets] = await Promise.all([
      problemWorkspaceFileRepo.withTx(tx).findByProblemId(problem.id),
      testcaseSetRepo.withTx(tx).findByProblemId(problem.id),
    ]);
    await problemWorkspaceFileRepo.withTx(tx).deleteByProblemId(problem.id);
    await testcaseSetRepo.withTx(tx).deleteByProblemId(problem.id);

    const resetJudgeConfig = {
      type: "standard",
    } satisfies Prisma.InputJsonValue;

    await problemRepo.withTx(tx).update(problem.id, {
      type: "special_env",
      samples: Prisma.JsonNull,
      judgeConfig: resetJudgeConfig,
      advancedConfig: Prisma.JsonNull,
      checkerStorage: Prisma.DbNull,
      interactorStorage: Prisma.DbNull,
      activeStorageBytes: {
        decrement:
          workspaceFiles.reduce(
            (total, file) => total + assertStorageObjectPointer(file.contentStorage).size,
            0,
          ) +
          testcaseSets.reduce(
            (total, set) =>
              total +
              set.testcases.reduce(
                (caseTotal, testcase) => caseTotal + testcaseStorageSize(testcase),
                0,
              ),
            0,
          ) +
          optionalPointerSize(problem.checkerStorage) +
          optionalPointerSize(problem.interactorStorage),
      },
      storageGeneration: { increment: 1 },
    });
    await commitStoragePointerSwap(tx, {
      added: [],
      removed: [
        ...workspaceFiles.map(({ contentStorage }) =>
          assertStorageObjectPointer(contentStorage),
        ),
        ...testcaseSets.flatMap(({ testcases }) => testcases.flatMap(testcaseStoragePointers)),
        ...[problem.checkerStorage, problem.interactorStorage]
          .filter((pointer) => pointer !== null)
          .map(assertStorageObjectPointer),
      ],
    });
  });
}

export interface SetProblemInteractorInput {
  content: string;
  language: JudgeScriptLanguage;
}

export async function setProblemInteractor(
  actor: ProblemActorContext,
  problemId: string,
  input: SetProblemInteractorInput,
): Promise<{ id: string }> {
  await assertProblemEditAccess(actor, problemId);

  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  const existing = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
    type: "interactive" as const,
  };
  return saveProblemJudgeConfig(actor, problemId, {
    judgeConfig: { ...existing, type: "interactive", interactorLanguage: input.language },
    interactorScript: input.content,
  });
}

export interface SetProblemCheckerInput {
  content: string;
  language: JudgeScriptLanguage;
}

export async function setProblemChecker(
  actor: ProblemActorContext,
  problemId: string,
  input: SetProblemCheckerInput,
): Promise<{ id: string }> {
  await assertProblemEditAccess(actor, problemId);

  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);

  const existing = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
    type: "checker" as const,
  };

  return saveProblemJudgeConfig(actor, problemId, {
    judgeConfig: { ...existing, type: "checker", checkerLanguage: input.language },
    checkerScript: input.content,
  });
}

function optionalPointerSize(value: unknown): number {
  return value === null ? 0 : assertStorageObjectPointer(value).size;
}

function testcaseStorageSize(testcase: {
  inputStorage: unknown;
  outputStorage: unknown;
  inputFileStorage: unknown;
}): number {
  const files = testcase.inputFileStorage;
  if (files !== null && (!files || typeof files !== "object" || Array.isArray(files))) {
    throw new Error("Persisted testcase input-file storage map is malformed");
  }
  return (
    assertStorageObjectPointer(testcase.inputStorage).size +
    optionalPointerSize(testcase.outputStorage) +
    Object.values((files ?? {}) as Record<string, unknown>).reduce(
      (total: number, pointer) => total + assertStorageObjectPointer(pointer).size,
      0,
    )
  );
}

function testcaseStoragePointers(testcase: {
  inputStorage: unknown;
  outputStorage: unknown;
  inputFileStorage: unknown;
}): StorageObjectPointer[] {
  const files = testcase.inputFileStorage;
  if (files !== null && (!files || typeof files !== "object" || Array.isArray(files))) {
    throw new Error("Persisted testcase input-file storage map is malformed");
  }
  return [
    assertStorageObjectPointer(testcase.inputStorage),
    ...(testcase.outputStorage === null
      ? []
      : [assertStorageObjectPointer(testcase.outputStorage)]),
    ...Object.values((files ?? {}) as Record<string, unknown>).map(assertStorageObjectPointer),
  ];
}

function problemStoragePointers(problem: {
  checkerStorage: unknown;
  interactorStorage: unknown;
  workspaceFiles: readonly { contentStorage: unknown }[];
  testcaseSets: readonly {
    testcases: readonly {
      inputStorage: unknown;
      outputStorage: unknown;
      inputFileStorage: unknown;
    }[];
  }[];
}): StorageObjectPointer[] {
  return [
    ...[problem.checkerStorage, problem.interactorStorage]
      .filter((pointer) => pointer !== null)
      .map(assertStorageObjectPointer),
    ...problem.workspaceFiles.map(({ contentStorage }) =>
      assertStorageObjectPointer(contentStorage),
    ),
    ...problem.testcaseSets.flatMap(({ testcases }) =>
      testcases.flatMap(testcaseStoragePointers),
    ),
  ];
}
