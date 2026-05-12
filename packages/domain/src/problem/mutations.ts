import { randomUUID } from "node:crypto";

import {
  Prisma,
  problemRepo,
  problemStatementRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  SubtaskScoringStrategy,
  testcaseRepo,
  testcaseSetRepo,
  type TransactionClient,
} from "@nojv/db";
import type {
  Language,
  ProblemCreate,
  ProblemImageSource,
  ProblemStatus,
  ProblemTestcaseSetCreate,
  ProblemType,
  ProblemUpdate,
  ProblemVisibility,
  TestcaseSetUpdate,
  TestcaseUpdate,
} from "@nojv/core";
import type { ProblemDifficulty } from "@nojv/core";
import { DEFAULT_LOCALE, entryFileNameFor, judgeConfigSchema } from "@nojv/core";

import { ConflictError, NotFoundError, ValidationError } from "../shared/errors";
import { requireProblem } from "../shared/require";
import { stripUndefined } from "../shared/strip-undefined";
import { ensureUser } from "../user/mutations";

import {
  bestEffortDeleteProblemBlobs,
  bestEffortDeleteProblemStandardBlobs,
  bestEffortDeleteTestcaseBlobs,
  bestEffortDeleteWorkspaceBlob,
  overwriteTestcaseField,
  writeTestcaseBlobs,
  writeWorkspaceFileBlob,
  type TestcaseBlobKeys,
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
// Workspace mutations
// ─────────────────────────────────────────────────────────────────────────

export interface UpdateWorkspacePayload {
  runtime?: {
    timeLimitMs: number;
    memoryLimitMb: number;
    env: Record<string, string>;
  };
  allowedLanguages?: Language[];
  type?: ProblemType;
  files: {
    language: Language;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    orderIndex?: number;
  }[];
}

// 1 MB aggregate cap per (problem, language); the per-file 200 KB cap is
// enforced earlier via the zod schema in `@nojv/core`.
const MAX_WORKSPACE_BYTES_PER_LANGUAGE = 1_048_576;

export async function updateProblemWorkspace(
  actor: ProblemActorContext,
  problemId: string,
  payload: UpdateWorkspacePayload,
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
        (f) => f.path === entryPath && f.visibility === "editable",
      ).length;
      if (editableEntryCount !== 1) {
        brokenLanguages.push(
          `Language '${language}' must have exactly one editable file named '${entryPath}'`,
        );
      }
    }
    if (brokenLanguages.length > 0) {
      throw new ValidationError(`Workspace invariant violated: ${brokenLanguages.join("; ")}.`);
    }
  }

  // Multi-file invariant: every allowed language MUST ship an editable
  // main file. Full-source problems can leave the workspace empty —
  // templates are just a UX nicety there.
  if (
    payload.type === "multi_file" &&
    payload.allowedLanguages &&
    payload.allowedLanguages.length > 0
  ) {
    const entryByLanguage = new Set<string>();
    for (const file of payload.files) {
      if (file.visibility === "editable" && file.path === entryFileNameFor(file.language)) {
        entryByLanguage.add(file.language);
      }
    }
    const missing = payload.allowedLanguages.filter((lang) => !entryByLanguage.has(lang));
    if (missing.length > 0) {
      throw new ValidationError(
        `Multi-file problems require an editable main file for every allowed language. Missing: ${missing.join(", ")}.`,
      );
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
        `Workspace files for language "${language}" exceed 1 MB limit (${String(total)} bytes).`,
      );
    }
  }

  // Authorize FIRST so unauthorised callers can't trigger S3 traffic.
  // We re-check inside the transaction below to handle the rare race
  // where ownership flips between this read and the write.
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
  });

  // Pre-allocate row ids so we can compute stable S3 keys, then upload
  // every file's content BEFORE entering the DB transaction. The S3 puts
  // happen in parallel; failure short-circuits the entire update with
  // zero side effects (no DB rows touched, the existing rows + their
  // S3 objects are untouched).
  interface PreparedWorkspaceFile {
    id: string;
    contentKey: string;
    file: UpdateWorkspacePayload["files"][number];
  }
  const prepared: PreparedWorkspaceFile[] = await Promise.all(
    payload.files.map(async (file) => {
      const id = randomUUID();
      const contentKey = await writeWorkspaceFileBlob(problemId, id, file.content);
      return { id, contentKey, file };
    }),
  );

  // Read the existing file rows BEFORE the transaction so we can sweep
  // their S3 objects after the DB delete commits.
  const existingFiles = await problemWorkspaceFileRepo.findByProblemId(problemId);

  const result = await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    // Replace workspace files.
    await problemWorkspaceFileRepo.withTx(tx).deleteByProblemId(problem.id);
    if (prepared.length > 0) {
      const rows: Prisma.ProblemWorkspaceFileCreateManyInput[] = prepared.map(
        (entry, index) => ({
          id: entry.id,
          contentKey: entry.contentKey,
          language: entry.file.language,
          orderIndex: entry.file.orderIndex ?? index,
          path: entry.file.path,
          problemId: problem.id,
          visibility: entry.file.visibility,
        }),
      );
      await problemWorkspaceFileRepo.withTx(tx).createMany(rows);
    }

    // Merge runtime into judgeConfig.runtime + persist type. Keep other
    // judgeConfig keys intact so the caller can save workspace without
    // clobbering the judge settings.
    const updateData: Prisma.ProblemUpdateInput = {};
    if (payload.runtime) {
      // Validate existing judgeConfig before merging — silently dropping a
      // corrupt blob preserves the new runtime, the alternative is to lose
      // the user's update because of historical bad data.
      const parsed = judgeConfigSchema.safeParse(problem.judgeConfig);
      const currentConfig = parsed.success ? parsed.data : { type: "standard" as const };
      updateData.judgeConfig = {
        ...currentConfig,
        runtime: payload.runtime,
      } as Prisma.InputJsonValue;
      updateData.memoryLimitMb = payload.runtime.memoryLimitMb;
      updateData.timeLimitMs = payload.runtime.timeLimitMs;
    }
    if (payload.type && payload.type !== problem.type) {
      if (payload.type === "special_env") {
        throw new ValidationError(
          "Cannot switch to special_env via workspace update. Use convertToAdvanced instead.",
        );
      }
      updateData.type = payload.type;
    }
    if (Object.keys(updateData).length > 0) {
      await problemRepo.withTx(tx).update(problem.id, updateData);
    }

    return { id: problem.id, fileCount: payload.files.length };
  });

  // DB committed — best-effort sweep of the OLD workspace blobs. The
  // new ids are random UUIDs so they cannot collide with the just-deleted
  // ones; failures here only leave orphan objects.
  await Promise.all(existingFiles.map((f) => bestEffortDeleteWorkspaceBlob(problemId, f.id)));

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Testcase mutations
// ─────────────────────────────────────────────────────────────────────────

const MAX_TESTCASE_SETS_PER_PROBLEM = 20;

export async function createProblemTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemTestcaseSetCreate,
) {
  // 1. Pre-allocate testcase ids so we can compute stable S3 keys, then
  //    upload the blobs OUTSIDE the DB transaction. Upload failure throws
  //    here with zero side effects (no DB rows, no orphan blobs because
  //    PutObject is the only operation that ran).
  interface PreparedCase {
    id: string;
    blobKeys: TestcaseBlobKeys;
  }
  const prepared: PreparedCase[] = await Promise.all(
    payload.cases.map(async (tc) => {
      const id = randomUUID();
      const blobKeys = await writeTestcaseBlobs({
        problemId,
        testcaseId: id,
        input: tc.input,
        output: tc.output,
      });
      return { id, blobKeys };
    }),
  );

  // 2. Now the transaction: ownership check, set creation, and createMany.
  //    The S3 objects already exist; if this transaction rolls back the
  //    blobs become orphans (tolerable per design).
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    const existingCount = await tx.testcaseSet.count({
      where: { problemId: problem.id },
    });
    if (existingCount >= MAX_TESTCASE_SETS_PER_PROBLEM) {
      throw new ConflictError(
        `A problem can have at most ${String(MAX_TESTCASE_SETS_PER_PROBLEM)} testcase sets.`,
      );
    }

    // TestcaseSet has @@unique([problemId, ordinal]) + ordinal defaults to 0,
    // so every call without an explicit ordinal would collide. Compute the
    // next slot by reading the current max within the transaction.
    const { _max } = await tx.testcaseSet.aggregate({
      where: { problemId: problem.id },
      _max: { ordinal: true },
    });
    const nextOrdinal = (_max.ordinal ?? -1) + 1;

    const testcaseSet = await testcaseSetRepo.withTx(tx).create({
      name: payload.name,
      problemId: problem.id,
      weight: payload.weight,
      ordinal: nextOrdinal,
    });

    const rows: Prisma.TestcaseCreateManyInput[] = prepared.map((entry, index) => {
      const row: Prisma.TestcaseCreateManyInput = {
        id: entry.id,
        ordinal: index + 1,
        testcaseSetId: testcaseSet.id,
        inputKey: entry.blobKeys.inputKey,
      };
      if (entry.blobKeys.outputKey !== null) row.outputKey = entry.blobKeys.outputKey;
      if (entry.blobKeys.inputFileKeys !== null) {
        row.inputFileKeys = entry.blobKeys.inputFileKeys as Prisma.InputJsonValue;
      }
      return row;
    });
    await testcaseRepo.withTx(tx).createMany(rows);

    return {
      caseCount: payload.cases.length,
      id: testcaseSet.id,
      name: testcaseSet.name,
    };
  });
}

export async function updateTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  setId: string,
  payload: TestcaseSetUpdate,
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
  setId: string,
) {
  // Fetch the set's testcase ids first so we know which S3 prefixes to
  // sweep after the DB delete commits. Each testcase has a stable prefix
  // under `problems/{problemId}/testcases/{testcaseId}/` — sweeping the
  // set in one shot would also work, but per-testcase keeps the cleanup
  // surgical and matches the per-row deletion that `deleteTestcase`
  // already does.
  const existing = await testcaseSetRepo.findById(setId);
  const testcaseIds = existing?.testcases.map((tc) => tc.id) ?? [];

  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    await testcaseSetRepo.delete(setId);
  });

  // DB committed — best-effort S3 cleanup. Failure here only leaves
  // orphan objects, which the design accepts.
  await Promise.all(testcaseIds.map((id) => bestEffortDeleteTestcaseBlobs(problemId, id)));
}

export async function updateTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
  payload: TestcaseUpdate,
) {
  // Authorize first so unauthorised callers can't trigger S3 traffic.
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
  });

  // Pure content edit: the row's key columns already point at the
  // correct S3 objects (keys are stable for the lifetime of the row),
  // so we just overwrite the blobs in place — no DB UPDATE required.
  // Touch only the fields that were explicitly provided.
  const writes: Promise<unknown>[] = [];
  if (payload.input !== undefined) {
    writes.push(overwriteTestcaseField(problemId, testcaseId, "input", payload.input));
  }
  if (payload.output !== undefined) {
    writes.push(overwriteTestcaseField(problemId, testcaseId, "output", payload.output));
  }
  await Promise.all(writes);

  return { id: testcaseId };
}

export async function deleteTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
) {
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    await testcaseRepo.delete(testcaseId);
  });

  // DB committed — best-effort S3 cleanup.
  await bestEffortDeleteTestcaseBlobs(problemId, testcaseId);
}

function isSubtaskScoringStrategy(value: string): value is SubtaskScoringStrategy {
  return (Object.values(SubtaskScoringStrategy) as string[]).includes(value);
}

// Validates the raw string against the SubtaskScoringStrategy enum and runs
// the edit-access check before writing. Keeps route handlers out of the
// business of enumerating the enum values themselves.
export async function setTestcaseSetScoringStrategy(
  actor: ProblemActorContext,
  problemId: string,
  setId: string,
  rawStrategy: string,
): Promise<void> {
  if (!isSubtaskScoringStrategy(rawStrategy)) {
    throw new ValidationError("Invalid scoring strategy");
  }
  await assertProblemEditAccess(actor, problemId);
  await testcaseSetRepo.updateScoringStrategy(setId, rawStrategy);
}
