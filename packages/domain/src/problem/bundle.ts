import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import archiver from "archiver";
import { Open, type Entry as ZipEntry, type File as ZipFile } from "unzipper";

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
} from "./blobs";
import { assertProblemEditAccess, type ProblemActorContext } from "./permissions";
import { PROBLEM_STORAGE_BUDGET_BYTES } from "./storage-budget";

import {
  checkerKey as checkerKeyFor,
  deleteBlob,
  getText,
  interactorKey as interactorKeyFor,
  listByPrefix,
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
 * S3 or DB calls. Caller enforces problem-edit access BEFORE invoking
 * this so unauthorised uploads short-circuit before we spend memory
 * unzipping.
 *
 * Size enforcement is per-entry STREAMING, not central-directory-trust:
 * the `File.uncompressedSize` field comes straight from the zip's central
 * directory and is attacker-controlled. A deflate bomb can declare 1 byte
 * per entry while each stream actually inflates to 100 MB. We therefore
 * read each entry as a stream, accumulate inflated bytes as they arrive,
 * and abort the moment cumulative bytes exceed the 50 MB cap.
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
  let runningBytes = 0;

  for (const entry of fileEntries) {
    const remaining = MAX_BUNDLE_UNCOMPRESSED_BYTES - runningBytes;
    const buf = await readEntryBounded(entry, remaining);
    runningBytes += buf.byteLength;
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

  return { testcases, workspace, checker, interactor, totalBytes: runningBytes };
}

/**
 * Stream a single zip entry into a Buffer, aborting once `maxBytes` of
 * INFLATED data have flowed past. Treats `File.uncompressedSize` as
 * advisory only — the cap is enforced on the actual inflated stream so a
 * deflate bomb (small declared size, large compressed-stream output)
 * cannot OOM the worker.
 *
 * On budget overrun we reject, then call `autodrain` to release the
 * inflater pipeline so the per-entry zlib state can be GC'd promptly.
 */
async function readEntryBounded(entry: ZipFile, maxBytes: number): Promise<Buffer> {
  if (maxBytes <= 0) {
    throw new ConflictError(
      `Bundle exceeds ${String(MAX_BUNDLE_UNCOMPRESSED_BYTES)} bytes uncompressed.`,
    );
  }
  const stream: ZipEntry = entry.stream();
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const onData = (chunk: Buffer): void => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        // Drain remaining bytes so the underlying zlib stream releases
        // its buffers; ignore drain errors since we've already rejected.
        try {
          void stream
            .autodrain()
            .promise()
            .catch(() => {
              // swallow drain errors — we've already rejected the parse
            });
        } catch {
          // autodrain may throw synchronously on a closed stream; ignore.
        }
        reject(
          new ConflictError(
            `Bundle entry "${entry.path}" pushes inflated total past ${String(MAX_BUNDLE_UNCOMPRESSED_BYTES)} bytes.`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    };
    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
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
 * dropped before the new rows are written. Ordering:
 *
 *   1. enumerate old testcase/workspace keys (snapshot the pre-state)
 *   2. write every NEW blob (fresh UUIDs → no collision with old keys)
 *   3. commit DB transaction (rows now point at already-written blobs)
 *   4. best-effort delete the OLD blobs by individual key
 *
 * If step 2 fails partway: DB is untouched, old blobs still live, new
 * blobs at fresh UUIDs are orphans the cleanup sweep removes.
 *
 * If step 3 fails: tx rolls back, DB unchanged, new blobs are orphans.
 *
 * If step 4 fails: DB points at the (already-written) new blobs, old
 * blobs linger and get cleaned later.
 *
 * What this ordering prevents (the bug it fixes): a window where the DB
 * commit lands BEFORE the put completes, during which a judge or edit
 * loader gets NoSuchKey from S3.
 */
export async function importBundle(
  actor: ProblemActorContext,
  problemId: string,
  zipBuffer: Buffer,
): Promise<{ id: string; testcaseCount: number; workspaceCount: number }> {
  // Authorise FIRST so unauthorised callers can't trigger any work.
  await assertProblemEditAccess(actor, problemId);

  const parsed = await parseBundle(zipBuffer);

  // Bundle import is a wholesale REPLACE of testcase + workspace blobs,
  // so the budget check is a post-state ceiling, not a current+delta sum.
  // Using `assertProblemStorageBudget` here would reject any re-import on
  // a problem currently near the cap (it adds new bytes on top of current
  // usage, but the current usage is about to be removed). The 50 MB cap
  // still applies to the bundle's own inflated size.
  if (parsed.totalBytes > PROBLEM_STORAGE_BUDGET_BYTES) {
    throw new ConflictError(
      `Bundle exceeds ${String(PROBLEM_STORAGE_BUDGET_BYTES)} bytes per-problem cap.`,
    );
  }

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

  const client = getClient();

  // Phase 1a: snapshot the OLD keys so we can delete them individually
  // after the DB commit. We can't `deleteBlobsByPrefix` after the commit
  // because the prefix now contains the just-written new blobs too.
  const newKeySet = new Set<string>();
  for (const t of preparedTestcases) {
    newKeySet.add(t.inputKey);
    if (t.outputKey !== null) newKeySet.add(t.outputKey);
  }
  for (const w of preparedWorkspace) {
    newKeySet.add(w.contentKey);
  }
  const oldStandardKeys: string[] = [];
  const [oldTestcaseKeys, oldWorkspaceKeys] = await Promise.all([
    listByPrefix(client, `problems/${problemId}/testcases/`),
    listByPrefix(client, `problems/${problemId}/workspace/`),
  ]);
  for (const k of oldTestcaseKeys) if (!newKeySet.has(k)) oldStandardKeys.push(k);
  for (const k of oldWorkspaceKeys) if (!newKeySet.has(k)) oldStandardKeys.push(k);

  // Phase 1b: stage every new blob. Random UUIDs mean these CANNOT
  // collide with any existing testcase/workspace key. Checker/interactor
  // keys ARE stable per-problem, so a put here overwrites the old body
  // in place — that's fine because the DB key reference is unchanged.
  const stagedPuts: Promise<unknown>[] = [];
  for (const t of preparedTestcases) {
    stagedPuts.push(putText(client, t.inputKey, t.input));
    if (t.outputKey !== null && t.output !== null) {
      stagedPuts.push(putText(client, t.outputKey, t.output));
    }
  }
  for (const w of preparedWorkspace) {
    stagedPuts.push(putText(client, w.contentKey, w.content));
  }
  if (parsed.checker) {
    stagedPuts.push(putText(client, checkerKeyFor(problemId), parsed.checker.content));
  }
  if (parsed.interactor) {
    stagedPuts.push(putText(client, interactorKeyFor(problemId), parsed.interactor.content));
  }
  await Promise.all(stagedPuts);

  // Phase 2: commit the DB transaction. Rows now reference blobs that are
  // already in S3 — no NoSuchKey window for concurrent readers.
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
      type: parsed.checker ? "checker" : parsed.interactor ? "interactive" : currentCfg.type,
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

  // Phase 3: DB committed — best-effort delete the OLD blobs by
  // individual key. We CANNOT prefix-delete here because the prefix now
  // contains the just-written new blobs as well; the `oldStandardKeys`
  // snapshot taken before the puts captures only stale keys.
  const cleanupDeletes: Promise<unknown>[] = oldStandardKeys.map((key) =>
    deleteBlob(client, key).catch((err: unknown) => {
      console.warn(
        `[problem-bundle] orphan S3 blob after import: problemId=${problemId} key=${key}`,
        err,
      );
    }),
  );
  // Checker/interactor keys are stable per-problem, so the new put (if
  // any) already overwrote the old body in place. We only delete when the
  // new bundle explicitly drops that validator.
  if (!parsed.checker) cleanupDeletes.push(bestEffortDeleteCheckerScriptBlob(problemId));
  if (!parsed.interactor) cleanupDeletes.push(bestEffortDeleteInteractorScriptBlob(problemId));
  await Promise.all(cleanupDeletes);

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
 * Memory is bounded: blobs are fetched from S3 sequentially and piped into
 * archiver one entry at a time. Archiver's output flows through a
 * PassThrough that we expose as a Web `ReadableStream` so the SvelteKit
 * route can return it as the `Response` body — chunks leave the server as
 * they are produced, never building up the full zip in process memory.
 * Caller MUST hold problem-edit access (raw testcase/checker bodies are
 * author/admin-only).
 */
export async function exportBundle(
  actor: ProblemActorContext,
  problemId: string,
): Promise<ReadableStream<Uint8Array>> {
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

  const parsedCfg = judgeConfigSchema.safeParse(problem.judgeConfig);
  const cfg: JudgeConfig = parsedCfg.success ? parsedCfg.data : { type: "standard" as const };

  const archive = archiver("zip", { zlib: { level: 9 } });
  // archiver is a Transform, but Readable.toWeb's overload resolution for
  // Duplex subclasses isn't clean. Pipe through a PassThrough so the web
  // wrapper sees a plain Readable.
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  // Producer: fetch each blob from S3 sequentially and append into the
  // archive. Runs concurrently with the consumer that's draining the Web
  // stream returned below; archiver applies backpressure via `pipe`, so
  // memory stays bounded to a single in-flight blob plus the archiver's
  // internal compressor state (~MB-class, not problem-sized).
  void (async () => {
    try {
      const client = getClient();
      for (let i = 0; i < flatTestcases.length; i++) {
        const tc = flatTestcases[i]!;
        const input = await getText(client, tc.inputKey);
        archive.append(input, { name: `testcases/${String(i)}/input.txt` });
        if (tc.outputKey) {
          const answer = await getText(client, tc.outputKey);
          archive.append(answer, { name: `testcases/${String(i)}/answer.txt` });
        }
      }
      for (const w of workspaceFiles) {
        const content = await getText(client, w.contentKey);
        // `path` is the stored relative path (e.g. `main.cpp`); we keep it
        // verbatim so round-trip preserves the author's filename.
        archive.append(content, { name: `workspace/${w.path}` });
      }
      if (cfg.checkerKey && cfg.checkerLanguage) {
        const body = await getText(client, cfg.checkerKey);
        const ext = cfg.checkerLanguage === "python" ? "py" : "cpp";
        archive.append(body, { name: `checker.${ext}` });
      }
      if (cfg.interactorKey && cfg.interactorLanguage) {
        const body = await getText(client, cfg.interactorKey);
        const ext = cfg.interactorLanguage === "python" ? "py" : "cpp";
        archive.append(body, { name: `interactor.${ext}` });
      }
      await archive.finalize();
    } catch (err) {
      // Tear the pipeline down: archive.destroy propagates the error to
      // the PassThrough → web ReadableStream consumer, which will reject
      // the in-flight `read()` and signal failure to the HTTP client.
      const wrapped = err instanceof Error ? err : new Error(String(err));
      archive.destroy(wrapped);
      passthrough.destroy(wrapped);
    }
  })();

  return Readable.toWeb(passthrough) as ReadableStream<Uint8Array>;
}
