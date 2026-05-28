import {
  Prisma,
  problemRepo,
  problemStatementRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  testcaseSetRepo,
  type TransactionClient,
} from "@nojv/db";
import type {
  JudgeConfig,
  JudgeScriptLanguage,
  ProblemCreate,
  ProblemImageSource,
  ProblemStatus,
  ProblemType,
  ProblemUpdate,
  ProblemVisibility,
} from "@nojv/core";
import type { ProblemDifficulty } from "@nojv/core";
import { DEFAULT_LOCALE, judgeConfigSchema } from "@nojv/core";

import { ConflictError, NotFoundError, ValidationError } from "../shared/errors";
import { requireProblem } from "../shared/require";
import { ensureUser } from "../user/mutations";

import {
  bestEffortDeleteCheckerScriptBlob,
  bestEffortDeleteInteractorScriptBlob,
  bestEffortDeleteProblemBlobs,
  bestEffortDeleteProblemStandardBlobs,
  writeCheckerScriptBlob,
  writeInteractorScriptBlob,
} from "./blobs";
import {
  assertProblemEditAccess,
  assertProblemOwnership,
  type ProblemActorContext,
} from "./permissions";

// ─────────────────────────────────────────────────────────────────────────
// Problem CRUD
// ─────────────────────────────────────────────────────────────────────────

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
  input: CreateProblemDefinitionInput,
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
    visibility: input.visibility ?? "public",
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
      title: input.title,
    });
  }

  return problem;
}

export async function deleteProblemRecord(actor: ProblemActorContext, problemId: string) {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  assertProblemOwnership(problem, actor);

  // DB delete first — Prisma cascade handles every child row (testcase
  // sets, testcases, workspace files). Then best-effort sweep the entire
  // S3 prefix; failure here only leaves orphan objects.
  const deleted = await problemRepo.delete(problemId);
  await bestEffortDeleteProblemBlobs(problemId);
  return deleted;
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
      visibility: payload.visibility,
    });

    return problem;
  });
}

export async function updateProblemRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemUpdate,
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);

    assertProblemOwnership(problem, actor);

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
    const mergedType = payload.type ?? problem.type;
    const mergedImageRef = payload.advancedImageRef ?? problem.advancedImageRef;
    const mergedImageSource = payload.advancedImageSource ?? problem.advancedImageSource;
    const hasImage = Boolean(mergedImageRef) && Boolean(mergedImageSource);
    if (mergedType === "special_env" && !hasImage) {
      throw new ValidationError(
        "special_env problems require both advancedImageRef and advancedImageSource.",
      );
    }
    if (mergedType !== "special_env" && hasImage) {
      throw new ValidationError(
        "advancedImageRef / advancedImageSource are only allowed on special_env problems.",
      );
    }

    if (payload.difficulty !== undefined) updateData.difficulty = payload.difficulty;
    if (payload.tags !== undefined) updateData.tags = payload.tags;

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
        DEFAULT_LOCALE,
        {
          bodyMarkdown: payload.statement ?? "",
          inputFormat: payload.inputFormat ?? "",
          locale: DEFAULT_LOCALE,
          outputFormat: payload.outputFormat ?? "",
          problemId: problem.id,
          title: payload.title ?? problem.title,
        },
        {
          ...(payload.statement !== undefined ? { bodyMarkdown: payload.statement } : {}),
          ...(payload.inputFormat !== undefined ? { inputFormat: payload.inputFormat } : {}),
          ...(payload.outputFormat !== undefined ? { outputFormat: payload.outputFormat } : {}),
          ...(payload.title !== undefined ? { title: payload.title } : {}),
        },
      );
    }

    return { id: problem.id };
  });
}

export interface SaveJudgeConfigInput {
  /** Parsed judgeConfig from the editor — carries type + *Language, never the script body. */
  judgeConfig: JudgeConfig;
  /** Raw checker script body (only meaningful when type === "checker"). */
  checkerScript?: string | undefined;
  /** Raw interactor script body (only meaningful when type === "interactive"). */
  interactorScript?: string | undefined;
}

/**
 * Persist a problem's judge config, moving the checker/interactor script
 * bodies to object storage. The JSON column keeps only the storage key.
 *
 * S3 first, then the DB write — a failed upload short-circuits before any
 * column change. Stale blobs for the now-unused judge type are swept
 * best-effort after the DB commits.
 */
export async function saveProblemJudgeConfig(
  actor: ProblemActorContext,
  problemId: string,
  input: SaveJudgeConfigInput,
): Promise<{ id: string }> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  assertProblemOwnership(problem, actor);

  const { type } = input.judgeConfig;
  // .trim() decides upload-vs-clear; the stored body keeps its original
  // bytes (a script's trailing newline is meaningful).
  const checkerBody =
    type === "checker" && (input.checkerScript ?? "").trim() ? input.checkerScript : null;
  const interactorBody =
    type === "interactive" && (input.interactorScript ?? "").trim()
      ? input.interactorScript
      : null;

  const checkerKey =
    checkerBody != null ? await writeCheckerScriptBlob(problemId, checkerBody) : null;
  const interactorKey =
    interactorBody != null ? await writeInteractorScriptBlob(problemId, interactorBody) : null;

  const judgeConfig: JudgeConfig = {
    type,
    ...(checkerKey ? { checkerKey, checkerLanguage: input.judgeConfig.checkerLanguage } : {}),
    ...(interactorKey
      ? { interactorKey, interactorLanguage: input.judgeConfig.interactorLanguage }
      : {}),
    ...(input.judgeConfig.runtime ? { runtime: input.judgeConfig.runtime } : {}),
  };

  const result = await updateProblemRecord(actor, problemId, { judgeConfig });

  if (!checkerKey) await bestEffortDeleteCheckerScriptBlob(problemId);
  if (!interactorKey) await bestEffortDeleteInteractorScriptBlob(problemId);

  return result;
}

/**
 * Update the `advancedRequiredPaths` array on a special_env problem.
 *
 * The create-time `superRefine` arm on `problemCreateSchema` enforces that
 * non-special_env problems can't carry required paths, but
 * `problemUpdateSchema.partial()` strips that refine, so we re-check here.
 */
export async function updateAdvancedRequiredPaths(
  actor: ProblemActorContext,
  problemId: string,
  paths: string[],
): Promise<void> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  assertProblemOwnership(problem, actor);

  if (problem.type !== "special_env" && paths.length > 0) {
    throw new ConflictError("Required paths can only be set on special_env problems.");
  }

  await problemRepo.updateAdvancedRequiredPaths(problemId, paths);
}

// ─────────────────────────────────────────────────────────────────────────
// Problem mode conversion (standard → special_env)
// Data-lossy: workspace files, testcase sets, samples, and judgeConfig are
// discarded. The UI shows an explicit warning before calling this.
// ─────────────────────────────────────────────────────────────────────────

export async function convertProblemToAdvancedMode(
  actor: ProblemActorContext,
  problemId: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    if (problem.type === "special_env") {
      throw new ConflictError("Problem is already a special_env problem.");
    }

    // Drop workspace files and testcase sets. Testcases cascade via the
    // `onDelete: Cascade` relation on Testcase.testcaseSetId.
    await problemWorkspaceFileRepo.withTx(tx).deleteByProblemId(problem.id);
    await testcaseSetRepo.withTx(tx).deleteByProblemId(problem.id);

    // special_env mode ignores judgeConfig in the runner, but the column
    // is `Json?` and other call sites still read it; write a minimal
    // valid value rather than leaving the previous standard-mode config.
    const resetJudgeConfig = {
      type: "standard",
    } satisfies Prisma.InputJsonValue;

    await problemRepo.withTx(tx).update(problem.id, {
      type: "special_env",
      samples: Prisma.JsonNull,
      judgeConfig: resetJudgeConfig,
      advancedImageRef: "",
      advancedImageSource: "registry",
    });
  });

  // DB committed — best-effort sweep of testcase + workspace blobs only.
  // Advanced-mode tarballs and markdown images live under different
  // prefixes and are preserved.
  await bestEffortDeleteProblemStandardBlobs(problemId);
}

// ─────────────────────────────────────────────────────────────────────────
// Interactor source upload (W3.C)
//
// Writes the interactor script body to object storage at
// `interactorKey(problemId)`, then patches `problem.judgeConfig` so it
// carries the storage key + language. Mirrors the checker-side helper in
// shape — the per-route HTTP adapter is just request parsing + budget +
// access guards, with this function as the single place that touches both
// S3 and the row.
// ─────────────────────────────────────────────────────────────────────────

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

  // Write the body first — a failed upload short-circuits before any
  // column change, matching the saveProblemJudgeConfig pattern above.
  const key = await writeInteractorScriptBlob(problemId, input.content);

  const existing = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
    type: "interactive" as const,
  };

  const nextJudgeConfig: JudgeConfig = {
    ...existing,
    // Force `interactive` so a problem author can land here from a stale
    // judge type without leaving the row in an inconsistent state.
    type: "interactive",
    interactorKey: key,
    interactorLanguage: input.language,
  };

  return updateProblemRecord(actor, problemId, { judgeConfig: nextJudgeConfig });
}

// ─────────────────────────────────────────────────────────────────────────
// Checker source upload (W3.B)
//
// Same shape as setProblemInteractor above: write the script body to
// `checkerKey(problemId)` first, then patch `problem.judgeConfig` to carry
// the storage key + language. Forces `type: "checker"` so the row never
// ends up advertising a checker script under a `standard`/`interactive`
// judge type.
// ─────────────────────────────────────────────────────────────────────────

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

  const key = await writeCheckerScriptBlob(problemId, input.content);

  const existing = judgeConfigSchema.safeParse(problem.judgeConfig).data ?? {
    type: "checker" as const,
  };

  const nextJudgeConfig: JudgeConfig = {
    ...existing,
    type: "checker",
    checkerKey: key,
    checkerLanguage: input.language,
  };

  return updateProblemRecord(actor, problemId, { judgeConfig: nextJudgeConfig });
}
