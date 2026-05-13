import { randomUUID } from "node:crypto";

import type { Prisma } from "@nojv/db";
import { problemRepo, problemWorkspaceFileRepo, runTransaction } from "@nojv/db";
import type { Language, ProblemType } from "@nojv/core";
import { entryFileNameFor, judgeConfigSchema } from "@nojv/core";

import { ConflictError, ValidationError } from "../shared/errors";
import { requireProblem } from "../shared/require";

import { bestEffortDeleteWorkspaceBlob, writeWorkspaceFileBlob } from "./blobs";
import { assertProblemOwnership, type ProblemActorContext } from "./permissions";

// ─────────────────────────────────────────────────────────────────────────
// Workspace mutations
// ─────────────────────────────────────────────────────────────────────────

export interface UpdateWorkspaceInput {
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
  payload: UpdateWorkspaceInput,
) {
  // Workspace-mode invariant: every language present in the payload
  // must ship EXACTLY ONE editable file named `main.<ext>`. The judge
  // and submission validator both rely on this — violating it means
  // students in that language cannot submit anything.
  if (payload.files.length > 0) {
    const filesByLanguage = new Map<Language, UpdateWorkspaceInput["files"]>();
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
    file: UpdateWorkspaceInput["files"][number];
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
