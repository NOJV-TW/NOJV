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
  Language,
  PlatformRole,
  ProblemCreate,
  ProblemImageSource,
  ProblemStatus,
  ProblemTestcaseSetCreate,
  ProblemType,
  ProblemUpdate,
  ProblemVisibility,
  TestcaseSetUpdate,
  TestcaseUpdate
} from "@nojv/core";
import { DEFAULT_LOCALE, entryFileNameFor, problemDifficulties } from "@nojv/core";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} from "../shared/errors";
import { stripUndefined } from "../shared/strip-undefined";
import { ensureUser } from "../user/mutations";

export interface ProblemActorContext {
  userId: string;
  username: string;
  platformRole: PlatformRole;
}

/**
 * Callers still send a `difficulty` form field (dropdown UX), but it's
 * persisted as a tag — splice it back into the tag list so the row always
 * has exactly one of {easy, medium, hard}.
 */
function mergeDifficultyTag(
  baseTags: string[] | undefined,
  difficulty: string | undefined
): string[] {
  const stripped = (baseTags ?? []).filter(
    (tag) => !(problemDifficulties as readonly string[]).includes(tag)
  );
  if (difficulty && (problemDifficulties as readonly string[]).includes(difficulty)) {
    return [difficulty, ...stripped];
  }
  return stripped;
}

export interface CreateProblemDefinitionInput {
  authorId?: string | undefined;
  /** Stored as a tag entry; not its own column. */
  difficulty?: string | undefined;
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
  // Phase 1 redesign: ProblemType is the single source of truth.
  type?: ProblemType | undefined;
  /** Only meaningful when type = special_env. Otherwise ignored. */
  networkEnabled?: boolean | undefined;
  advancedImageRef?: string | undefined;
  advancedImageSource?: ProblemImageSource | undefined;
}

export async function createProblemDefinition(
  tx: TransactionClient,
  input: CreateProblemDefinitionInput
) {
  const type: ProblemType = input.type ?? "full_source";
  const tags = mergeDifficultyTag(input.tags, input.difficulty);

  const createData: Prisma.ProblemUncheckedCreateInput = {
    authorId: input.authorId ?? null,
    title: input.title,
    memoryLimitMb: input.memoryLimitMb ?? 256,
    networkEnabled: type === "special_env" ? (input.networkEnabled ?? false) : false,
    samples: Prisma.JsonNull,
    status: input.status ?? "published",
    tags,
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

/**
 * Public helper: verify `actor` may edit `problemId`. Intended for callers
 * (e.g. image upload endpoints) that need the ownership check without
 * performing a DB mutation. Throws `NotFoundError` or `ForbiddenError`.
 */
export async function assertProblemEditAccess(
  actor: ProblemActorContext,
  problemId: string
): Promise<void> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  assertProblemOwnership(problem, actor);
}

/**
 * Workspace-mode invariant: when adding a problem to a contest or
 * homework assessment whose `allowedLanguages` list is non-empty, the
 * problem MUST ship an editable `main.<ext>` workspace file for every
 * listed language. Otherwise students in that language have no entry
 * file to submit. Empty `allowedLanguages` means "any language allowed",
 * which we don't enforce here — only the languages the problem ships.
 *
 * Throws `ValidationError` listing every offending language.
 */
export async function assertProblemHasWorkspaceForLanguages(
  tx: TransactionClient,
  problemId: string,
  allowedLanguages: Language[]
): Promise<void> {
  if (allowedLanguages.length === 0) return;

  const workspaceFiles = await problemWorkspaceFileRepo.findByProblemId(problemId);

  const missing: Language[] = [];
  for (const language of allowedLanguages) {
    const entryPath = entryFileNameFor(language);
    const hasEntry = workspaceFiles.some(
      (f) => f.language === language && f.path === entryPath && f.visibility === "editable"
    );
    if (!hasEntry) missing.push(language);
  }

  if (missing.length > 0) {
    throw new ValidationError(
      `Problem ${problemId} is missing editable main.<ext> files for: ${missing.join(", ")}.`
    );
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
      authorId: author.id,
      difficulty: payload.difficulty,
      inputFormat: payload.inputFormat,
      judgeConfig: payload.judgeConfig,
      memoryLimitMb: payload.memoryLimitMb,
      networkEnabled: payload.networkEnabled,
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
    if (payload.networkEnabled !== undefined) {
      updateData.networkEnabled = payload.networkEnabled;
    }
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

    // Tags + difficulty: rebuild whenever either field is provided so
    // the difficulty tag stays consistent with the rest of the list.
    if (payload.tags !== undefined || payload.difficulty !== undefined) {
      const baseTags = payload.tags ?? problem.tags;
      updateData.tags = mergeDifficultyTag(baseTags, payload.difficulty);
    }

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

/**
 * Convert a standard-mode problem to special_env (advanced) mode. The
 * conversion is intentionally data-lossy: workspace files, testcase sets
 * (and their testcases via cascade), `samples`, and `judgeConfig` are
 * discarded and special_env defaults are written. The UI shows an
 * explicit warning before calling this.
 *
 * Throws `ConflictError` if the problem is already in special_env mode.
 */
export async function convertProblemToAdvancedMode(
  actor: ProblemActorContext,
  problemId: string
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
      type: "standard"
    } satisfies Prisma.InputJsonValue;

    await problemRepo.withTx(tx).update(problem.id, {
      type: "special_env",
      networkEnabled: false,
      samples: Prisma.JsonNull,
      judgeConfig: resetJudgeConfig,
      advancedImageRef: "",
      advancedImageSource: "registry"
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
  // Workspace-mode invariant: every language present in the payload
  // must ship EXACTLY ONE editable file named `main.<ext>`. The judge
  // and submission validator both rely on this — violating it means
  // students in that language cannot submit anything.
  if (payload.files.length > 0) {
    const filesByLanguage = new Map<Language, UpdateWorkspacePayload["files"]>();
    for (const file of payload.files) {
      const bucket = filesByLanguage.get(file.language);
      if (bucket) bucket.push(file);
      else filesByLanguage.set(file.language, [file]);
    }

    const brokenLanguages: string[] = [];
    for (const [language, files] of filesByLanguage) {
      const entryPath = entryFileNameFor(language);
      const editableEntryCount = files.filter(
        (f) => f.path === entryPath && f.visibility === "editable"
      ).length;
      if (editableEntryCount !== 1) {
        brokenLanguages.push(
          `Language '${language}' must have exactly one editable file named '${entryPath}'`
        );
      }
    }
    if (brokenLanguages.length > 0) {
      throw new ValidationError(`Workspace invariant violated: ${brokenLanguages.join("; ")}.`);
    }
  }

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
      throw new ConflictError(
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
 * Replace the special_env testcase bag for a problem. Wholesale
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

    // TestcaseSet has @@unique([problemId, ordinal]) + ordinal defaults to 0,
    // so every call without an explicit ordinal would collide. Compute the
    // next slot by reading the current max within the transaction.
    const { _max } = await tx.testcaseSet.aggregate({
      where: { problemId: problem.id },
      _max: { ordinal: true }
    });
    const nextOrdinal = (_max.ordinal ?? -1) + 1;

    const testcaseSet = await testcaseSetRepo.withTx(tx).create({
      name: payload.name,
      problemId: problem.id,
      weight: payload.weight,
      ordinal: nextOrdinal
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
