import { randomUUID } from "node:crypto";

import archiver from "archiver";
import { Open, type File as ZipFile } from "unzipper";

import type { Prisma } from "@nojv/db";
import {
  problemRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  testcaseRepo,
  testcaseSetRepo,
} from "@nojv/db";
import type { JudgeConfig, JudgeScriptLanguage, Language } from "@nojv/core";
import { judgeConfigSchema } from "@nojv/core";

import { ConflictError, ValidationError } from "../shared/errors";
import { requireProblem } from "../shared/require";

import {
  bestEffortDeleteCheckerScriptBlob,
  bestEffortDeleteInteractorScriptBlob,
  bestEffortDeleteProblemStandardBlobs,
} from "./blobs";
import { assertProblemEditAccess, type ProblemActorContext } from "./permissions";
import { assertProblemStorageBudget } from "./storage-budget";

import {
  checkerKey as checkerKeyFor,
  getText,
  interactorKey as interactorKeyFor,
  putText,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
  createStorageClient,
} from "@nojv/storage";

// Inferred to avoid pulling @aws-sdk/client-s3 into @nojv/domain.
type StorageClient = ReturnType<typeof createStorageClient>;

let cachedClient: StorageClient | null = null;

function getClient(): StorageClient {
  cachedClient ??= createStorageClient();
  return cachedClient;
}

/** Uncompressed-bytes cap; matches the per-problem storage budget. */
const MAX_BUNDLE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
/** Hard cap on entry count — guards against zip-bomb directory bloat. */
const MAX_BUNDLE_ENTRIES = 200;

// File-extension → checker/interactor script language. Only `.cpp` and
// `.py` are valid because `judgeScriptLanguageSchema` accepts exactly those
// two. `.js` is documented in the spec but not a real option; we treat it
// as a validation error to keep the round-trip honest.
const CHECKER_SCRIPT_LANG: Record<string, JudgeScriptLanguage> = {
  cpp: "cpp",
  py: "python",
};

// File-extension → workspace-file language. Mirrors `languageExtension`
// in @nojv/core (reverse direction). Anything outside this map is dropped
// during workspace import — the bundle format has no other channel for
// language metadata, so unmapped extensions can't be persisted.
const WORKSPACE_LANG_BY_EXT: Record<string, Language> = {
  c: "c",
  cpp: "cpp",
  go: "go",
  java: "java",
  js: "javascript",
  py: "python",
  rs: "rust",
  ts: "typescript",
};

interface BundleTestcase {
  index: number;
  input: string;
  answer: string | null;
}

interface BundleWorkspaceFile {
  language: Language;
  path: string;
  content: string;
}

interface BundleValidatorScript {
  language: JudgeScriptLanguage;
  content: string;
}

interface ParsedBundle {
  testcases: BundleTestcase[];
  workspace: BundleWorkspaceFile[];
  checker: BundleValidatorScript | null;
  interactor: BundleValidatorScript | null;
  totalBytes: number;
}

function isUnsafePath(p: string): boolean {
  if (p.length === 0) return true;
  if (p.startsWith("/")) return true;
  if (p.includes("\\")) return true;
  if (p.includes("\0")) return true;
  // Match any `..` path segment — `..foo` and `foo..bar` are safe.
  return p.split("/").some((segment) => segment === "..");
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Parse + validate a zip buffer into the four bundle sections. Pure: no
 * S3 or DB calls. Caller enforces problem-edit access and the storage
 * budget BEFORE invoking this so unauthorised uploads short-circuit
 * before we spend memory unzipping.
 */
async function parseBundle(zipBuffer: Buffer): Promise<ParsedBundle> {
  let archive;
  try {
    archive = await Open.buffer(zipBuffer);
  } catch (err) {
    throw new ValidationError(
      `Invalid zip archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const fileEntries = archive.files.filter((f) => f.type === "File");

  if (fileEntries.length > MAX_BUNDLE_ENTRIES) {
    throw new ConflictError(
      `Bundle has too many entries (${String(fileEntries.length)} > ${String(MAX_BUNDLE_ENTRIES)}).`,
    );
  }

  let total = 0;
  for (const f of fileEntries) total += f.uncompressedSize;
  if (total > MAX_BUNDLE_UNCOMPRESSED_BYTES) {
    throw new ConflictError(
      `Bundle exceeds ${String(MAX_BUNDLE_UNCOMPRESSED_BYTES)} bytes uncompressed (${String(total)}).`,
    );
  }

  // Validate every path BEFORE reading any content so a malicious entry
  // can't trigger I/O before we reject it.
  for (const entry of fileEntries) {
    if (isUnsafePath(entry.path)) {
      throw new ValidationError(`Invalid path in bundle: ${entry.path}`);
    }
  }

  const testcaseMap = new Map<number, { input?: string; answer?: string }>();
  const workspace: BundleWorkspaceFile[] = [];
  let checker: BundleValidatorScript | null = null;
  let interactor: BundleValidatorScript | null = null;

  for (const entry of fileEntries) {
    const buf = await readEntry(entry);
    const text = buf.toString("utf8");

    const testcaseMatch = /^testcases\/(\d+)\/(input|answer)\.txt$/.exec(entry.path);
    if (testcaseMatch) {
      const idx = Number(testcaseMatch[1]);
      const field = testcaseMatch[2] as "input" | "answer";
      const bucket = testcaseMap.get(idx) ?? {};
      bucket[field] = text;
      testcaseMap.set(idx, bucket);
      continue;
    }

    if (entry.path.startsWith("workspace/")) {
      const relPath = entry.path.slice("workspace/".length);
      if (relPath.length === 0) continue;
      const ext = extOf(relPath);
      const lang = WORKSPACE_LANG_BY_EXT[ext];
      if (!lang) continue; // Drop unknown extensions; can't infer language.
      workspace.push({ language: lang, path: relPath, content: text });
      continue;
    }

    const validatorMatch = /^(checker|interactor)\.(cpp|py|js)$/.exec(entry.path);
    if (validatorMatch) {
      const [, roleRaw, ext = ""] = validatorMatch;
      const role = roleRaw as "checker" | "interactor";
      const lang = CHECKER_SCRIPT_LANG[ext];
      if (!lang) {
        throw new ValidationError(
          `Unsupported ${role} script extension: .${ext} (only .cpp and .py are accepted).`,
        );
      }
      const script: BundleValidatorScript = { language: lang, content: text };
      if (role === "checker") checker = script;
      else interactor = script;
      continue;
    }

    // Silently skip unrecognised top-level entries (e.g. a README the
    // author tossed in). Tighter validation would surface authoring
    // typos but also reject harmless metadata files.
  }

  // Assemble testcases in numeric order, requiring at least an `input` for
  // each index to be useful. Entries that are answer-only are dropped.
  const testcases: BundleTestcase[] = [];
  const sortedIndices = Array.from(testcaseMap.keys()).sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    const bucket = testcaseMap.get(idx);
    if (!bucket?.input) continue;
    testcases.push({
      index: idx,
      input: bucket.input,
      answer: bucket.answer ?? null,
    });
  }

  return { testcases, workspace, checker, interactor, totalBytes: total };
}

async function readEntry(entry: ZipFile): Promise<Buffer> {
  return entry.buffer();
}

/**
 * Replace a problem's testcase sets, workspace files, and checker/interactor
 * scripts from a single zip archive. Bundle format (per spec):
 *
 *   testcases/<N>/input.txt
 *   testcases/<N>/answer.txt
 *   workspace/<path>           (language inferred from extension)
 *   checker.<cpp|py>
 *   interactor.<cpp|py>
 *
 * Replacement is wholesale: every existing testcase set / workspace file is
 * dropped before the new rows are written. S3 puts happen AFTER the DB
 * transaction commits — matching the project-wide "DB is the source of
 * truth, blobs are best-effort" convention for replace flows. A failed S3
 * put leaves the DB pointing at keys that don't yet exist; the next read
 * will surface a NoSuchKey error which the caller MUST handle.
 *
 * Old blobs under the standard prefixes (`testcases/`, `workspace/`,
 * `validator/`) are swept best-effort after the new puts finish, so the
 * problem ends in a clean state on success.
 */
export async function importBundle(
  actor: ProblemActorContext,
  problemId: string,
  zipBuffer: Buffer,
): Promise<{ id: string; testcaseCount: number; workspaceCount: number }> {
  // Authorise FIRST so unauthorised callers can't trigger any work.
  await assertProblemEditAccess(actor, problemId);

  const parsed = await parseBundle(zipBuffer);

  // Quota check runs against the CURRENT problem prefix usage + the new
  // bytes. We don't subtract the about-to-be-deleted old bytes here — the
  // bundle's `totalBytes` is the worst-case headroom after the import
  // completes (DB delete + S3 sweep happen later). Importing a 40 MB
  // bundle onto a 30 MB problem rejects, which matches the user-facing
  // "50 MB per problem" promise.
  await assertProblemStorageBudget(problemId, parsed.totalBytes);

  // Pre-allocate ids so we can compute stable S3 keys before either the
  // DB write OR the storage put. Mirrors the pattern in `updateProblem-
  // Workspace` / `createProblemTestcaseSetRecord`.
  interface PreparedTestcase {
    id: string;
    inputKey: string;
    outputKey: string | null;
    input: string;
    output: string | null;
  }
  const preparedTestcases: PreparedTestcase[] = parsed.testcases.map((tc) => {
    const id = randomUUID();
    return {
      id,
      inputKey: testcaseInputKey(problemId, id),
      outputKey: tc.answer !== null ? testcaseOutputKey(problemId, id) : null,
      input: tc.input,
      output: tc.answer,
    };
  });

  interface PreparedWorkspaceFile {
    id: string;
    contentKey: string;
    language: Language;
    path: string;
    content: string;
  }
  const preparedWorkspace: PreparedWorkspaceFile[] = parsed.workspace.map((w) => {
    const id = randomUUID();
    return {
      id,
      contentKey: workspaceFileKey(problemId, id),
      language: w.language,
      path: w.path,
      content: w.content,
    };
  });

  // Deduplicate workspace files on the (problemId, language, path) unique
  // index — last write wins. A bundle with duplicate paths would fail at
  // createMany; better to filter here with a clear error than leak a
  // Prisma constraint violation.
  const seenWorkspace = new Set<string>();
  for (const w of preparedWorkspace) {
    const key = `${w.language}::${w.path}`;
    if (seenWorkspace.has(key)) {
      throw new ConflictError(
        `Workspace bundle contains duplicate file: language=${w.language} path=${w.path}`,
      );
    }
    seenWorkspace.add(key);
  }

  const result = await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);

    // Wholesale replace: drop existing testcase sets + workspace files.
    await testcaseSetRepo.withTx(tx).deleteByProblemId(problem.id);
    await problemWorkspaceFileRepo.withTx(tx).deleteByProblemId(problem.id);

    let testcaseCount = 0;
    if (preparedTestcases.length > 0) {
      const set = await testcaseSetRepo.withTx(tx).create({
        name: "Imported",
        problemId: problem.id,
        weight: 1,
        ordinal: 0,
      });
      const rows: Prisma.TestcaseCreateManyInput[] = preparedTestcases.map((t, i) => {
        const row: Prisma.TestcaseCreateManyInput = {
          id: t.id,
          ordinal: i + 1,
          testcaseSetId: set.id,
          inputKey: t.inputKey,
        };
        if (t.outputKey !== null) row.outputKey = t.outputKey;
        return row;
      });
      await testcaseRepo.withTx(tx).createMany(rows);
      testcaseCount = preparedTestcases.length;
    }

    if (preparedWorkspace.length > 0) {
      const rows: Prisma.ProblemWorkspaceFileCreateManyInput[] = preparedWorkspace.map(
        (w, i) => ({
          id: w.id,
          contentKey: w.contentKey,
          language: w.language,
          orderIndex: i,
          path: w.path,
          problemId: problem.id,
          visibility: "editable",
        }),
      );
      await problemWorkspaceFileRepo.withTx(tx).createMany(rows);
    }

    // Update judgeConfig: switch type based on which validator is present,
    // and stamp the key + language. Wipe the opposite slot so a stale key
    // can't outlive its blob.
    const parsedCfg = judgeConfigSchema.safeParse(problem.judgeConfig);
    const currentCfg: JudgeConfig = parsedCfg.success
      ? parsedCfg.data
      : { type: "standard" as const };

    const nextCfg: JudgeConfig = {
      type: parsed.checker
        ? "checker"
        : parsed.interactor
          ? "interactive"
          : currentCfg.type,
      ...(parsed.checker
        ? { checkerKey: checkerKeyFor(problem.id), checkerLanguage: parsed.checker.language }
        : { checkerKey: null, checkerLanguage: null }),
      ...(parsed.interactor
        ? {
            interactorKey: interactorKeyFor(problem.id),
            interactorLanguage: parsed.interactor.language,
          }
        : { interactorKey: null, interactorLanguage: null }),
      ...(currentCfg.runtime ? { runtime: currentCfg.runtime } : {}),
    };

    await problemRepo.withTx(tx).update(problem.id, {
      judgeConfig: nextCfg,
    });

    return {
      id: problem.id,
      testcaseCount,
      workspaceCount: preparedWorkspace.length,
    };
  });

  // DB committed — sweep the OLD blobs (testcases + workspace files) so
  // they can't drift past the new ids. Then write the new ones. We don't
  // do this in reverse (new puts first, then sweep) because the new keys
  // are random UUIDs and cannot collide with the just-deleted ones.
  await bestEffortDeleteProblemStandardBlobs(problemId);
  if (!parsed.checker) await bestEffortDeleteCheckerScriptBlob(problemId);
  if (!parsed.interactor) await bestEffortDeleteInteractorScriptBlob(problemId);

  const client = getClient();
  const puts: Promise<unknown>[] = [];
  for (const t of preparedTestcases) {
    puts.push(putText(client, t.inputKey, t.input));
    if (t.outputKey !== null && t.output !== null) {
      puts.push(putText(client, t.outputKey, t.output));
    }
  }
  for (const w of preparedWorkspace) {
    puts.push(putText(client, w.contentKey, w.content));
  }
  if (parsed.checker) {
    puts.push(putText(client, checkerKeyFor(problemId), parsed.checker.content));
  }
  if (parsed.interactor) {
    puts.push(putText(client, interactorKeyFor(problemId), parsed.interactor.content));
  }
  await Promise.all(puts);

  return result;
}

/**
 * Stream a problem's testcases, workspace files, checker, and interactor
 * into a single zip archive matching the layout `importBundle` consumes:
 *
 *   testcases/<N>/input.txt
 *   testcases/<N>/answer.txt   (only when an answer is stored)
 *   workspace/<path>
 *   checker.<cpp|py>           (only when judgeConfig.checkerKey set)
 *   interactor.<cpp|py>        (only when judgeConfig.interactorKey set)
 *
 * Buffered in memory — the 50 MB per-problem budget makes streaming the
 * response unnecessary for v1. Caller MUST hold problem-edit access (the
 * raw testcase/checker bodies are author/admin-only).
 */
export async function exportBundle(
  actor: ProblemActorContext,
  problemId: string,
): Promise<Buffer> {
  await assertProblemEditAccess(actor, problemId);

  const problem = await problemRepo.findById(problemId);
  if (!problem) {
    // assertProblemEditAccess already throws NotFoundError on missing,
    // so this branch is defensive only.
    throw new Error(`Problem disappeared after edit-access check: ${problemId}`);
  }

  const [sets, workspaceFiles] = await Promise.all([
    testcaseSetRepo.findByProblemId(problemId),
    problemWorkspaceFileRepo.findByProblemId(problemId),
  ]);

  // Flatten sets → ordered testcases. The bundle format collapses sets into
  // a single flat namespace numbered from 0, mirroring the import side.
  interface FlatTestcase {
    inputKey: string;
    outputKey: string | null;
  }
  const flatTestcases: FlatTestcase[] = [];
  for (const set of sets) {
    for (const tc of set.testcases) {
      flatTestcases.push({ inputKey: tc.inputKey, outputKey: tc.outputKey });
    }
  }

  // Pull every blob from S3 in parallel BEFORE constructing the archive.
  // archiver streams entries as we append, but resolving the contents up
  // front keeps the error path simple — any S3 read failure aborts before
  // we've allocated archive state.
  const client = getClient();
  const testcaseContents = await Promise.all(
    flatTestcases.map(async (tc) => {
      const [input, answer] = await Promise.all([
        getText(client, tc.inputKey),
        tc.outputKey ? getText(client, tc.outputKey) : Promise.resolve(null),
      ]);
      return { input, answer };
    }),
  );
  const workspaceContents = await Promise.all(
    workspaceFiles.map(async (f) => ({
      path: f.path,
      content: await getText(client, f.contentKey),
    })),
  );

  const parsedCfg = judgeConfigSchema.safeParse(problem.judgeConfig);
  const cfg: JudgeConfig = parsedCfg.success
    ? parsedCfg.data
    : { type: "standard" as const };

  const checkerBody =
    cfg.checkerKey && cfg.checkerLanguage
      ? await getText(client, cfg.checkerKey)
      : null;
  const interactorBody =
    cfg.interactorKey && cfg.interactorLanguage
      ? await getText(client, cfg.interactorKey)
      : null;

  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    testcaseContents.forEach((tc, i) => {
      archive.append(tc.input, { name: `testcases/${String(i)}/input.txt` });
      if (tc.answer !== null) {
        archive.append(tc.answer, { name: `testcases/${String(i)}/answer.txt` });
      }
    });

    for (const w of workspaceContents) {
      // `path` is the stored relative path (e.g. `main.cpp`); we keep it
      // verbatim so round-trip preserves the author's filename.
      archive.append(w.content, { name: `workspace/${w.path}` });
    }

    if (checkerBody !== null && cfg.checkerLanguage) {
      const ext = cfg.checkerLanguage === "python" ? "py" : "cpp";
      archive.append(checkerBody, { name: `checker.${ext}` });
    }
    if (interactorBody !== null && cfg.interactorLanguage) {
      const ext = cfg.interactorLanguage === "python" ? "py" : "cpp";
      archive.append(interactorBody, { name: `interactor.${ext}` });
    }

    void archive.finalize();
  });
}
