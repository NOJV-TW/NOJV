import { randomUUID } from "node:crypto";

import type { Prisma } from "@nojv/db";
import { problemRepo, problemWorkspaceFileRepo, runTransaction } from "@nojv/db";
import type { Language, ProblemType } from "@nojv/core";
import { entryFileNameFor, judgeConfigSchema, problemWorkspaceFileSchema } from "@nojv/core";

import { ConflictError, ValidationError } from "../shared/errors";
import { requireProblem } from "../shared/require";

import { bestEffortDeleteWorkspaceBlob, writeWorkspaceFileBlob } from "./blobs";
import { assertProblemOwnership, type ProblemActorContext } from "./permissions";

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

const MAX_WORKSPACE_BYTES_PER_LANGUAGE = 1_048_576;

export async function updateProblemWorkspace(
  actor: ProblemActorContext,
  problemId: string,
  payload: UpdateWorkspaceInput,
) {
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

  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
  });

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

  const existingFiles = await problemWorkspaceFileRepo.findByProblemId(problemId);

  const result = await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

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

    const updateData: Prisma.ProblemUpdateInput = {};
    if (payload.runtime) {
      const parsed = judgeConfigSchema.safeParse(problem.judgeConfig);
      const currentConfig = parsed.success ? parsed.data : { type: "standard" as const };
      updateData.judgeConfig = {
        ...currentConfig,
        runtime: payload.runtime,
      };
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

  await Promise.all(existingFiles.map((f) => bestEffortDeleteWorkspaceBlob(problemId, f.id)));

  return result;
}

export interface SetWorkspaceFileInput {
  language: string;
  path: string;
  visibility: string;
  content: string;
  orderIndex?: number;
}

export async function setWorkspaceFile(
  problemId: string,
  file: SetWorkspaceFileInput,
): Promise<{ id: string; problemId: string; path: string; language: Language }> {
  const parsed = problemWorkspaceFileSchema.parse({
    language: file.language,
    path: file.path,
    visibility: file.visibility,
    content: file.content,
    orderIndex: file.orderIndex ?? 0,
  });

  const id = randomUUID();
  const contentKey = await writeWorkspaceFileBlob(problemId, id, parsed.content);

  const existing = await problemWorkspaceFileRepo.findOne(
    problemId,
    parsed.language,
    parsed.path,
  );

  const row = await runTransaction(async (tx) => {
    return problemWorkspaceFileRepo.withTx(tx).upsertOne({
      id,
      problemId,
      language: parsed.language,
      path: parsed.path,
      contentKey,
      visibility: parsed.visibility,
      orderIndex: parsed.orderIndex,
    });
  });

  if (existing && existing.id !== row.id) {
    await bestEffortDeleteWorkspaceBlob(problemId, existing.id);
  }

  return {
    id: row.id,
    problemId: row.problemId,
    path: row.path,
    language: row.language,
  };
}
