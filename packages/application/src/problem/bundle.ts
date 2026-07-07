import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

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
} from "./blobs";
import { assertProblemEditAccess, type ProblemActorContext } from "./permissions";
import { PROBLEM_STORAGE_BUDGET_BYTES } from "./storage-budget";
import { readZipEntryBounded } from "./zip-utils";

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
} from "@nojv/storage";

import { storage, type StorageClient } from "../shared/storage-singleton";

const MAX_BUNDLE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 200;

const CHECKER_SCRIPT_LANG: Record<string, JudgeScriptLanguage> = {
  cpp: "cpp",
  py: "python",
};

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
  return p.split("/").includes("..");
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

async function openBundleEntries(zipBuffer: Buffer): Promise<ZipFile[]> {
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

  for (const entry of fileEntries) {
    if (isUnsafePath(entry.path)) {
      throw new ValidationError(`Invalid path in bundle: ${entry.path}`);
    }
  }

  return fileEntries;
}

interface BundleAccumulator {
  testcaseMap: Map<number, { input?: string; answer?: string }>;
  workspace: BundleWorkspaceFile[];
  checker: BundleValidatorScript | null;
  interactor: BundleValidatorScript | null;
}

function ingestTestcaseEntry(path: string, text: string, acc: BundleAccumulator): boolean {
  const testcaseMatch = /^testcases\/(\d+)\/(input|answer)\.txt$/.exec(path);
  if (!testcaseMatch) return false;
  const idx = Number(testcaseMatch[1]);
  const field = testcaseMatch[2] as "input" | "answer";
  const bucket = acc.testcaseMap.get(idx) ?? {};
  bucket[field] = text;
  acc.testcaseMap.set(idx, bucket);
  return true;
}

function ingestWorkspaceEntry(path: string, text: string, acc: BundleAccumulator): boolean {
  if (!path.startsWith("workspace/")) return false;
  const relPath = path.slice("workspace/".length);
  if (relPath.length === 0) return true;
  const ext = extOf(relPath);
  const lang = WORKSPACE_LANG_BY_EXT[ext];
  if (!lang) {
    throw new ValidationError(`Unsupported workspace file extension in bundle: ${relPath}`);
  }
  acc.workspace.push({ language: lang, path: relPath, content: text });
  return true;
}

function ingestValidatorEntry(path: string, text: string, acc: BundleAccumulator): boolean {
  const validatorMatch = /^(checker|interactor)\.(cpp|py|js)$/.exec(path);
  if (!validatorMatch) return false;
  const [, roleRaw, ext = ""] = validatorMatch;
  const role = roleRaw as "checker" | "interactor";
  const lang = CHECKER_SCRIPT_LANG[ext];
  if (!lang) {
    throw new ValidationError(
      `Unsupported ${role} script extension: .${ext} (only .cpp and .py are accepted).`,
    );
  }
  const script: BundleValidatorScript = { language: lang, content: text };
  if (role === "checker") acc.checker = script;
  else acc.interactor = script;
  return true;
}

function materializeTestcases(
  testcaseMap: Map<number, { input?: string; answer?: string }>,
): BundleTestcase[] {
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
  return testcases;
}

async function parseBundle(zipBuffer: Buffer): Promise<ParsedBundle> {
  const fileEntries = await openBundleEntries(zipBuffer);

  const acc: BundleAccumulator = {
    testcaseMap: new Map(),
    workspace: [],
    checker: null,
    interactor: null,
  };
  let runningBytes = 0;

  for (const entry of fileEntries) {
    const remaining = MAX_BUNDLE_UNCOMPRESSED_BYTES - runningBytes;
    const buf = await readZipEntryBounded(
      entry,
      remaining,
      (path) =>
        new ConflictError(
          `Bundle entry "${path}" pushes inflated total past ${String(MAX_BUNDLE_UNCOMPRESSED_BYTES)} bytes.`,
        ),
    );
    runningBytes += buf.byteLength;
    const text = buf.toString("utf8");

    if (ingestTestcaseEntry(entry.path, text, acc)) continue;
    if (ingestWorkspaceEntry(entry.path, text, acc)) continue;
    ingestValidatorEntry(entry.path, text, acc);
  }

  return {
    testcases: materializeTestcases(acc.testcaseMap),
    workspace: acc.workspace,
    checker: acc.checker,
    interactor: acc.interactor,
    totalBytes: runningBytes,
  };
}

interface PreparedTestcase {
  id: string;
  inputKey: string;
  outputKey: string | null;
  input: string;
  output: string | null;
}

interface PreparedWorkspaceFile {
  id: string;
  contentKey: string;
  language: Language;
  path: string;
  content: string;
}

function prepareTestcases(problemId: string, testcases: BundleTestcase[]): PreparedTestcase[] {
  return testcases.map((tc) => {
    const id = randomUUID();
    return {
      id,
      inputKey: testcaseInputKey(problemId, id),
      outputKey: tc.answer === null ? null : testcaseOutputKey(problemId, id),
      input: tc.input,
      output: tc.answer,
    };
  });
}

function prepareWorkspaceFiles(
  problemId: string,
  workspace: BundleWorkspaceFile[],
): PreparedWorkspaceFile[] {
  return workspace.map((w) => {
    const id = randomUUID();
    return {
      id,
      contentKey: workspaceFileKey(problemId, id),
      language: w.language,
      path: w.path,
      content: w.content,
    };
  });
}

function assertNoDuplicateWorkspaceFiles(prepared: PreparedWorkspaceFile[]): void {
  const seenWorkspace = new Set<string>();
  for (const w of prepared) {
    const key = `${w.language}::${w.path}`;
    if (seenWorkspace.has(key)) {
      throw new ConflictError(
        `Workspace bundle contains duplicate file: language=${w.language} path=${w.path}`,
      );
    }
    seenWorkspace.add(key);
  }
}

function collectNewKeySet(
  preparedTestcases: PreparedTestcase[],
  preparedWorkspace: PreparedWorkspaceFile[],
): Set<string> {
  const newKeySet = new Set<string>();
  for (const t of preparedTestcases) {
    newKeySet.add(t.inputKey);
    if (t.outputKey !== null) newKeySet.add(t.outputKey);
  }
  for (const w of preparedWorkspace) {
    newKeySet.add(w.contentKey);
  }
  return newKeySet;
}

function stageBundleUploads(
  client: StorageClient,
  problemId: string,
  testcases: PreparedTestcase[],
  workspace: PreparedWorkspaceFile[],
  parsed: ParsedBundle,
): Promise<unknown>[] {
  const puts: Promise<unknown>[] = [];
  for (const t of testcases) {
    puts.push(putText(client, t.inputKey, t.input));
    if (t.outputKey !== null && t.output !== null) {
      puts.push(putText(client, t.outputKey, t.output));
    }
  }
  for (const w of workspace) {
    puts.push(putText(client, w.contentKey, w.content));
  }
  if (parsed.checker) {
    puts.push(putText(client, checkerKeyFor(problemId), parsed.checker.content));
  }
  if (parsed.interactor) {
    puts.push(putText(client, interactorKeyFor(problemId), parsed.interactor.content));
  }
  return puts;
}

export async function importBundle(
  actor: ProblemActorContext,
  problemId: string,
  zipBuffer: Buffer,
): Promise<{ id: string; testcaseCount: number; workspaceCount: number }> {
  await assertProblemEditAccess(actor, problemId);

  const parsed = await parseBundle(zipBuffer);

  if (parsed.totalBytes > PROBLEM_STORAGE_BUDGET_BYTES) {
    throw new ConflictError(
      `Bundle exceeds ${String(PROBLEM_STORAGE_BUDGET_BYTES)} bytes per-problem cap.`,
    );
  }

  const preparedTestcases = prepareTestcases(problemId, parsed.testcases);
  const preparedWorkspace = prepareWorkspaceFiles(problemId, parsed.workspace);

  assertNoDuplicateWorkspaceFiles(preparedWorkspace);

  const client = storage();

  const newKeySet = collectNewKeySet(preparedTestcases, preparedWorkspace);
  const oldStandardKeys: string[] = [];
  const [oldTestcaseKeys, oldWorkspaceKeys] = await Promise.all([
    listByPrefix(client, `problems/${problemId}/testcases/`),
    listByPrefix(client, `problems/${problemId}/workspace/`),
  ]);
  for (const k of oldTestcaseKeys) if (!newKeySet.has(k)) oldStandardKeys.push(k);
  for (const k of oldWorkspaceKeys) if (!newKeySet.has(k)) oldStandardKeys.push(k);

  const stagedPuts = stageBundleUploads(
    client,
    problemId,
    preparedTestcases,
    preparedWorkspace,
    parsed,
  );
  await Promise.all(stagedPuts);

  const result = await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);

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

    const parsedCfg = judgeConfigSchema.safeParse(problem.judgeConfig);
    const currentCfg: JudgeConfig = parsedCfg.success
      ? parsedCfg.data
      : { type: "standard" as const };

    const interactorOrCurrentType = parsed.interactor ? "interactive" : currentCfg.type;
    const nextCfg: JudgeConfig = {
      type: parsed.checker ? "checker" : interactorOrCurrentType,
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

  const cleanupDeletes: Promise<unknown>[] = oldStandardKeys.map((key) =>
    deleteBlob(client, key).catch((err: unknown) => {
      console.warn(
        `[problem-bundle] orphan S3 blob after import: problemId=${problemId} key=${key}`,
        err,
      );
    }),
  );
  if (!parsed.checker) cleanupDeletes.push(bestEffortDeleteCheckerScriptBlob(problemId));
  if (!parsed.interactor) cleanupDeletes.push(bestEffortDeleteInteractorScriptBlob(problemId));
  await Promise.all(cleanupDeletes);

  return result;
}

export async function exportBundle(
  actor: ProblemActorContext,
  problemId: string,
): Promise<ReadableStream<Uint8Array>> {
  await assertProblemEditAccess(actor, problemId);

  const problem = await problemRepo.findById(problemId);
  if (!problem) {
    throw new Error(`Problem disappeared after edit-access check: ${problemId}`);
  }

  const [sets, workspaceFiles] = await Promise.all([
    testcaseSetRepo.findByProblemId(problemId),
    problemWorkspaceFileRepo.findByProblemId(problemId),
  ]);

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
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  void (async () => {
    try {
      const client = storage();
      for (const [i, tc] of flatTestcases.entries()) {
        const input = await getText(client, tc.inputKey);
        archive.append(input, { name: `testcases/${String(i)}/input.txt` });
        if (tc.outputKey) {
          const answer = await getText(client, tc.outputKey);
          archive.append(answer, { name: `testcases/${String(i)}/answer.txt` });
        }
      }
      for (const w of workspaceFiles) {
        const content = await getText(client, w.contentKey);
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
      const wrapped = err instanceof Error ? err : new Error(String(err));
      archive.destroy(wrapped);
      passthrough.destroy(wrapped);
    }
  })();

  return Readable.toWeb(passthrough) as ReadableStream<Uint8Array>;
}
