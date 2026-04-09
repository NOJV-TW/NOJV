import {
  advancedTestcaseRepo,
  Prisma,
  problemRepo,
  problemStatementRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  testcaseRepo,
  testcaseSetRepo,
  type TransactionClient
} from "@nojv/db";
import type {
  AdvancedResourceLimits,
  Language,
  PlatformRole,
  ProblemCreate,
  ProblemDifficulty,
  ProblemImageSource,
  ProblemMode,
  ProblemStatus,
  ProblemTestcaseSetCreate,
  ProblemUpdate,
  ProblemVisibility,
  SubmissionType,
  TestcaseSetUpdate,
  TestcaseUpdate
} from "@nojv/core";
import { DEFAULT_LOCALE } from "@nojv/core";

import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { stripUndefined } from "../shared/strip-undefined";
import { ensureUser } from "../user/mutations";

// ─── Actor context (domain-level, no SvelteKit dependency) ──────────

/**
 * Minimal actor context required by problem mutations.
 * Mirrors the CompletedActorContext from apps/web but without SvelteKit coupling.
 */
export interface ProblemActorContext {
  userId: string;
  username: string;
  platformRole: PlatformRole;
}

// ─── Input types ────────────────────────────────────────────────────

export interface CreateProblemDefinitionInput {
  authorId?: string | undefined;
  difficulty: ProblemDifficulty;
  inputFormat?: string | undefined;
  judgeConfig?: unknown;
  memoryLimitMb?: number | undefined;
  outputFormat?: string | undefined;
  statement?: string | undefined;
  status?: ProblemStatus | undefined;
  submissionType?: SubmissionType | undefined;
  summary: string;
  tags?: string[] | undefined;
  timeLimitMs?: number | undefined;
  title: string;
  visibility?: ProblemVisibility | undefined;
  // Phase 1 redesign: mode + advanced image/resource fields
  mode?: ProblemMode | undefined;
  advancedImageRef?: string | undefined;
  advancedImageSource?: ProblemImageSource | undefined;
  advancedResourceLimits?: AdvancedResourceLimits | undefined;
}

// ─── Shared problem helpers ─────────────────────────────────────────

export async function createProblemDefinition(
  tx: TransactionClient,
  input: CreateProblemDefinitionInput
) {
  const mode: ProblemMode = input.mode ?? "standard";
  const createData: Prisma.ProblemUncheckedCreateInput = {
    authorId: input.authorId ?? null,
    defaultTitle: input.title,
    difficulty: input.difficulty,
    memoryLimitMb: input.memoryLimitMb ?? 256,
    mode,
    samples: Prisma.JsonNull,
    status: input.status ?? "published",
    submissionType: input.submissionType ?? "full_source",
    summary: input.summary,
    tags: input.tags ?? [],
    timeLimitMs: input.timeLimitMs ?? 1_000,
    visibility: input.visibility ?? "public"
  };
  if (input.judgeConfig !== undefined) {
    createData.judgeConfig = input.judgeConfig as Prisma.InputJsonValue;
  }
  if (mode === "advanced") {
    createData.advancedImageRef = input.advancedImageRef ?? "";
    createData.advancedImageSource = input.advancedImageSource ?? "registry";
    createData.advancedResourceLimits = (input.advancedResourceLimits ?? {
      totalTimeMs: 30_000,
      memoryMb: 512,
      networkEnabled: false
    }) satisfies Prisma.InputJsonValue;
  } else {
    createData.advancedResourceLimits = Prisma.JsonNull;
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

export async function requireProblem(tx: TransactionClient, problemId: string) {
  const problem = await problemRepo.withTx(tx).findById(problemId);

  if (!problem) {
    throw new NotFoundError(`Problem not found: ${problemId}`);
  }

  return problem;
}

export function assertCourseProblemAccess(
  problem: { authorId: string | null; visibility: string },
  actor: ProblemActorContext
) {
  if (
    problem.visibility === "private" &&
    actor.platformRole !== "admin" &&
    problem.authorId !== actor.userId
  ) {
    throw new ForbiddenError(
      "Private problems can only be attached by their author or an admin."
    );
  }
}

function assertProblemOwnership(
  problem: { authorId: string | null },
  actor: ProblemActorContext
) {
  if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
    throw new ForbiddenError("Only the author or an admin can modify this problem.");
  }
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
      advancedResourceLimits: payload.advancedResourceLimits,
      authorId: author.id,
      difficulty: payload.difficulty,
      inputFormat: payload.inputFormat,
      judgeConfig: payload.judgeConfig,
      memoryLimitMb: payload.memoryLimitMb,
      mode: payload.mode,
      outputFormat: payload.outputFormat,
      statement: payload.statement,
      status: payload.status,
      submissionType: payload.submissionType,
      summary: payload.summary,
      tags: payload.tags,
      timeLimitMs: payload.timeLimitMs,
      title: payload.title,
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
    if (payload.title !== undefined) updateData.defaultTitle = payload.title;
    if (payload.difficulty !== undefined) updateData.difficulty = payload.difficulty;
    if (payload.visibility !== undefined) updateData.visibility = payload.visibility;
    if (payload.tags !== undefined) updateData.tags = payload.tags;
    if (payload.submissionType !== undefined)
      updateData.submissionType = payload.submissionType;
    if (payload.timeLimitMs !== undefined) updateData.timeLimitMs = payload.timeLimitMs;
    if (payload.memoryLimitMb !== undefined) updateData.memoryLimitMb = payload.memoryLimitMb;
    if (payload.summary !== undefined) updateData.summary = payload.summary;
    if (payload.judgeConfig !== undefined) updateData.judgeConfig = payload.judgeConfig;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.mode !== undefined) updateData.mode = payload.mode;
    if (payload.samples !== undefined) updateData.samples = payload.samples;
    if (payload.advancedImageRef !== undefined)
      updateData.advancedImageRef = payload.advancedImageRef;
    if (payload.advancedImageSource !== undefined)
      updateData.advancedImageSource = payload.advancedImageSource;
    if (payload.advancedResourceLimits !== undefined)
      updateData.advancedResourceLimits =
        payload.advancedResourceLimits as Prisma.InputJsonValue;

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
          title: payload.title ?? problem.defaultTitle
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

/**
 * Convert a Standard Mode problem to Advanced Mode. The conversion is
 * intentionally data-lossy: workspace files, testcase sets (and their
 * testcases via cascade), `samples`, and `judgeConfig` are discarded and
 * Advanced Mode defaults (empty image ref, registry source, default
 * resource limits) are written. The UI shows an explicit warning before
 * calling this.
 *
 * Throws `ConflictError` if the problem is already in advanced mode.
 */
export async function convertProblemToAdvancedMode(
  actor: ProblemActorContext,
  problemId: string
): Promise<void> {
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    if (problem.mode === "advanced") {
      throw new ConflictError("Problem is already in advanced mode.");
    }

    // Drop workspace files and testcase sets. Testcases cascade via the
    // `onDelete: Cascade` relation on Testcase.testcaseSetId.
    await problemWorkspaceFileRepo.withTx(tx).deleteByProblemId(problem.id);
    await testcaseSetRepo.withTx(tx).deleteByProblemId(problem.id);

    // Advanced Mode ignores judgeConfig, but the column is `Json?` and
    // callers still read it; write a minimal valid value rather than
    // leaving whatever standard-mode config was there.
    const resetJudgeConfig = {
      type: "standard",
      runtime: {
        timeLimitMs: 30_000,
        memoryLimitMb: 512,
        env: {}
      }
    } satisfies Prisma.InputJsonValue;

    await problemRepo.withTx(tx).update(problem.id, {
      mode: "advanced",
      samples: Prisma.JsonNull,
      judgeConfig: resetJudgeConfig,
      advancedImageRef: "",
      advancedImageSource: "registry",
      advancedResourceLimits: {
        totalTimeMs: 30_000,
        memoryMb: 512,
        networkEnabled: false
      } satisfies Prisma.InputJsonValue
    });
  });
}

export interface UpdateWorkspacePayload {
  runtime?: {
    timeLimitMs: number;
    memoryLimitMb: number;
    env: Record<string, string>;
  };
  allowedLanguages?: Language[];
  files: {
    language: Language;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    editableRegions: [number, number][] | null;
    orderIndex?: number;
  }[];
}

/**
 * Soft quota enforced on every workspace save: each `(problem, language)`
 * pair is capped at 1 MB of total UTF-8 content across all files. The
 * per-file 200 KB cap is enforced earlier via the zod schema in
 * `@nojv/core`; this constant is the per-language aggregate.
 */
const MAX_WORKSPACE_BYTES_PER_LANGUAGE = 1_048_576; // 1 MB

/**
 * Replace the workspace files for a problem and (optionally) update the
 * runtime config + allowed languages on the judge config.
 *
 * Replacement is wholesale: the existing ProblemWorkspaceFile rows are
 * deleted and the new list is inserted. This keeps the API simple for
 * callers and matches how the editor actually works (the whole payload
 * is sent on save).
 */
export async function updateProblemWorkspace(
  actor: ProblemActorContext,
  problemId: string,
  payload: UpdateWorkspacePayload
) {
  // Aggregate byte totals per language. Using Buffer.byteLength for an
  // accurate UTF-8 byte count — JS `.length` counts UTF-16 code units,
  // which under-counts multi-byte characters.
  const totalsByLanguage = new Map<string, number>();
  for (const file of payload.files) {
    const bytes = Buffer.byteLength(file.content, "utf8");
    totalsByLanguage.set(file.language, (totalsByLanguage.get(file.language) ?? 0) + bytes);
  }
  for (const [language, total] of totalsByLanguage) {
    if (total > MAX_WORKSPACE_BYTES_PER_LANGUAGE) {
      throw new Error(
        `Workspace files for language "${language}" exceed 1 MB limit (${String(total)} bytes).`
      );
    }
  }

  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    // Replace workspace files.
    await problemWorkspaceFileRepo.withTx(tx).deleteByProblemId(problem.id);
    if (payload.files.length > 0) {
      const rows: Prisma.ProblemWorkspaceFileCreateManyInput[] = payload.files.map(
        (f, index) => {
          const base: Prisma.ProblemWorkspaceFileCreateManyInput = {
            content: f.content,
            language: f.language,
            orderIndex: f.orderIndex ?? index,
            path: f.path,
            problemId: problem.id,
            visibility: f.visibility
          };
          if (f.editableRegions !== null) {
            base.editableRegions = f.editableRegions as Prisma.InputJsonValue;
          }
          return base;
        }
      );
      await problemWorkspaceFileRepo.withTx(tx).createMany(rows);
    }

    // Merge runtime into judgeConfig.runtime. Keep other judgeConfig
    // keys intact so the caller can save workspace without clobbering
    // the judge settings.
    if (payload.runtime) {
      const currentConfig = (problem.judgeConfig as Record<string, unknown> | null) ?? {};
      const nextConfig = {
        ...currentConfig,
        runtime: payload.runtime
      };
      await problemRepo.withTx(tx).update(problem.id, {
        judgeConfig: nextConfig as Prisma.InputJsonValue,
        memoryLimitMb: payload.runtime.memoryLimitMb,
        timeLimitMs: payload.runtime.timeLimitMs
      });
    }

    return { id: problem.id, fileCount: payload.files.length };
  });
}

export interface AdvancedTestcasePayload {
  stdin: string;
  expected: string;
  files: Record<string, string>;
}

/**
 * Replace the Advanced Mode testcase bag for a problem. Wholesale
 * replacement keeps the API simple for the UI (which ships the whole
 * list on save).
 */
export async function replaceAdvancedTestcases(
  actor: ProblemActorContext,
  problemId: string,
  cases: AdvancedTestcasePayload[]
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    await advancedTestcaseRepo.withTx(tx).deleteByProblemId(problem.id);

    if (cases.length > 0) {
      await advancedTestcaseRepo.withTx(tx).createMany(
        cases.map((c, index) => ({
          expected: c.expected,
          files: c.files as Prisma.InputJsonValue,
          ordinal: index,
          problemId: problem.id,
          stdin: c.stdin
        }))
      );
    }

    return { id: problem.id, count: cases.length };
  });
}

export async function createProblemTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemTestcaseSetCreate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);

    assertProblemOwnership(problem, actor);

    const testcaseSet = await testcaseSetRepo.withTx(tx).create({
      name: payload.name,
      problemId: problem.id,
      weight: payload.weight
    });

    await testcaseRepo.withTx(tx).createMany(
      payload.cases.map((testcase, index) => ({
        expectedStdout: testcase.expectedStdout,
        ordinal: index + 1,
        stdin: testcase.stdin,
        testcaseSetId: testcaseSet.id
      }))
    );

    return {
      caseCount: payload.cases.length,
      id: testcaseSet.id,
      name: testcaseSet.name
    };
  });
}

export async function updateTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  setId: string,
  payload: TestcaseSetUpdate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    return testcaseSetRepo.update(setId, stripUndefined(payload));
  });
}

export async function deleteTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  setId: string
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    return testcaseSetRepo.delete(setId);
  });
}

export async function updateTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
  payload: TestcaseUpdate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    return testcaseRepo.update(testcaseId, stripUndefined(payload));
  });
}

export async function deleteTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    return testcaseRepo.delete(testcaseId);
  });
}
