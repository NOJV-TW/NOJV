import {
  Prisma,
  problemRepo,
  problemStatementRepo,
  runTransaction,
  type TransactionClient
} from "@nojv/db";
import type {
  ProblemCreate,
  ProblemImageSource,
  ProblemStatus,
  ProblemType,
  ProblemUpdate,
  ProblemVisibility
} from "@nojv/core";
import type { ProblemDifficulty } from "@nojv/core";
import { DEFAULT_LOCALE } from "@nojv/core";

import { NotFoundError, ValidationError } from "../shared/errors";
import { ensureUser } from "../user/mutations";

import {
  assertProblemOwnership,
  requireProblem,
  type ProblemActorContext
} from "./helpers";

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
  advancedImageRef?: string | undefined;
  advancedImageSource?: ProblemImageSource | undefined;
}

export async function createProblemDefinition(
  tx: TransactionClient,
  input: CreateProblemDefinitionInput
) {
  const type: ProblemType = input.type ?? "full_source";

  const createData: Prisma.ProblemUncheckedCreateInput = {
    authorId: input.authorId ?? null,
    title: input.title,
    difficulty: input.difficulty ?? "medium",
    memoryLimitMb: input.memoryLimitMb ?? 256,
    samples: Prisma.JsonNull,
    status: input.status ?? "published",
    tags: input.tags ?? [],
    timeLimitMs: input.timeLimitMs ?? 1_000,
    type,
    visibility: input.visibility ?? "public"
  };
  if (input.judgeConfig !== undefined) {
    createData.judgeConfig = input.judgeConfig as Prisma.InputJsonValue;
  }
  if (type === "special_env") {
    createData.advancedImageRef = input.advancedImageRef ?? "";
    createData.advancedImageSource = input.advancedImageSource ?? "registry";
  }
  const problem = await problemRepo.withTx(tx).create(createData);

  if (input.statement) {
    await problemStatementRepo.withTx(tx).create({
      bodyMarkdown: input.statement,
      inputFormat: input.inputFormat ?? "",
      locale: DEFAULT_LOCALE,
      outputFormat: input.outputFormat ?? "",
      problemId: problem.id,
      title: input.title
    });
  }

  return problem;
}

export async function deleteProblemRecord(actor: ProblemActorContext, problemId: string) {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  assertProblemOwnership(problem, actor);
  return problemRepo.delete(problemId);
}

export async function createProblemRecord(actor: ProblemActorContext, payload: ProblemCreate) {
  return runTransaction(async (tx) => {
    const author = await ensureUser(tx, actor.userId, actor);

    const problem = await createProblemDefinition(tx, {
      advancedImageRef: payload.advancedImageRef,
      advancedImageSource: payload.advancedImageSource,
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
      visibility: payload.visibility
    });

    return problem;
  });
}

export async function updateProblemRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemUpdate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);

    assertProblemOwnership(problem, actor);

    // Build the problem update data — only include fields that were provided
    const updateData: Record<string, unknown> = {};
    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.visibility !== undefined) updateData.visibility = payload.visibility;
    if (payload.timeLimitMs !== undefined) updateData.timeLimitMs = payload.timeLimitMs;
    if (payload.memoryLimitMb !== undefined) updateData.memoryLimitMb = payload.memoryLimitMb;
    if (payload.judgeConfig !== undefined) updateData.judgeConfig = payload.judgeConfig;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.type !== undefined) updateData.type = payload.type;
    if (payload.samples !== undefined) updateData.samples = payload.samples;
    if (payload.advancedImageRef !== undefined)
      updateData.advancedImageRef = payload.advancedImageRef;
    if (payload.advancedImageSource !== undefined)
      updateData.advancedImageSource = payload.advancedImageSource;

    // Special-env invariant: the create path's zod `superRefine` enforces
    // `type === "special_env"` ⟺ (advancedImageRef && advancedImageSource),
    // but `problemUpdateSchema.partial()` strips the refine (ZodEffects
    // can't be partialed). Re-derive the merged row and check manually.
    const mergedType = (payload.type ?? problem.type) as ProblemType;
    const mergedImageRef = payload.advancedImageRef ?? problem.advancedImageRef;
    const mergedImageSource = payload.advancedImageSource ?? problem.advancedImageSource;
    const hasImage = Boolean(mergedImageRef) && Boolean(mergedImageSource);
    if (mergedType === "special_env" && !hasImage) {
      throw new ValidationError(
        "special_env problems require both advancedImageRef and advancedImageSource."
      );
    }
    if (mergedType !== "special_env" && hasImage) {
      throw new ValidationError(
        "advancedImageRef / advancedImageSource are only allowed on special_env problems."
      );
    }

    if (payload.difficulty !== undefined) updateData.difficulty = payload.difficulty;
    if (payload.tags !== undefined) updateData.tags = payload.tags;

    if (Object.keys(updateData).length > 0) {
      await problemRepo.withTx(tx).update(problem.id, updateData);
    }

    // Update statement if provided
    if (
      payload.statement !== undefined ||
      payload.inputFormat !== undefined ||
      payload.outputFormat !== undefined
    ) {
      await problemStatementRepo.withTx(tx).upsert(
        problem.id,
        DEFAULT_LOCALE,
        {
          bodyMarkdown: payload.statement ?? "",
          inputFormat: payload.inputFormat ?? "",
          locale: DEFAULT_LOCALE,
          outputFormat: payload.outputFormat ?? "",
          problemId: problem.id,
          title: payload.title ?? problem.title
        },
        {
          ...(payload.statement !== undefined ? { bodyMarkdown: payload.statement } : {}),
          ...(payload.inputFormat !== undefined ? { inputFormat: payload.inputFormat } : {}),
          ...(payload.outputFormat !== undefined ? { outputFormat: payload.outputFormat } : {}),
          ...(payload.title !== undefined ? { title: payload.title } : {})
        }
      );
    }

    return { id: problem.id };
  });
}
