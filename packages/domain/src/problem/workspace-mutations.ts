import {
  problemRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  type Prisma
} from "@nojv/db";
import type { Language } from "@nojv/core";
import { entryFileNameFor } from "@nojv/core";

import { ConflictError, ValidationError } from "../shared/errors";

import {
  assertProblemOwnership,
  requireProblem,
  type ProblemActorContext
} from "./helpers";

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

// 1 MB aggregate cap per (problem, language); the per-file 200 KB cap is
// enforced earlier via the zod schema in `@nojv/core`.
const MAX_WORKSPACE_BYTES_PER_LANGUAGE = 1_048_576;

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
