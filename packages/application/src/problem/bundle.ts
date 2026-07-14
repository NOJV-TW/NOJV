import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import archiver from "archiver";
import { Open, type File as ZipFile } from "unzipper";

import {
  Prisma,
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

import { assertProblemEditAccess, type ProblemActorContext } from "./permissions";
import { PROBLEM_STORAGE_BUDGET_BYTES } from "./storage-budget";
import { readZipEntryBounded } from "./zip-utils";

import {
  checkerKey as checkerKeyFor,
  assertStorageObjectPointer,
  getVerifiedText,
  interactorKey as interactorKeyFor,
  putImmutableText,
  storagePointerFor,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
  type StorageObjectPointer,
} from "@nojv/storage";

import { storage } from "../shared/storage-singleton";
import {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
} from "../shared/storage-object-lifecycle";

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
  inputStorage: StorageObjectPointer;
  outputStorage: StorageObjectPointer | null;
}

interface PreparedWorkspaceFile {
  id: string;
  contentStorage: StorageObjectPointer;
  language: Language;
  path: string;
}

async function prepareTestcases(
  problemId: string,
  testcases: BundleTestcase[],
): Promise<PreparedTestcase[]> {
  const client = storage();
  return Promise.all(
    testcases.map(async (testcase) => {
      const id = randomUUID();
      const version = randomUUID();
      const [inputStorage, outputStorage] = await Promise.all([
        putGuardedText(client, testcaseInputKey(problemId, id, version), testcase.input),
        testcase.answer === null
          ? Promise.resolve(null)
          : putGuardedText(client, testcaseOutputKey(problemId, id, version), testcase.answer),
      ]);
      return { id, inputStorage, outputStorage };
    }),
  );
}

async function prepareWorkspaceFiles(
  problemId: string,
  workspace: BundleWorkspaceFile[],
): Promise<PreparedWorkspaceFile[]> {
  const client = storage();
  return Promise.all(
    workspace.map(async (file) => {
      const id = randomUUID();
      return {
        id,
        contentStorage: await putGuardedText(
          client,
          workspaceFileKey(problemId, id, randomUUID()),
          file.content,
        ),
        language: file.language,
        path: file.path,
      };
    }),
  );
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

  const [preparedTestcases, preparedWorkspace, checkerStorage, interactorStorage] =
    await Promise.all([
      prepareTestcases(problemId, parsed.testcases),
      prepareWorkspaceFiles(problemId, parsed.workspace),
      parsed.checker
        ? putGuardedText(
            storage(),
            checkerKeyFor(problemId, randomUUID()),
            parsed.checker.content,
          )
        : Promise.resolve(null),
      parsed.interactor
        ? putGuardedText(
            storage(),
            interactorKeyFor(problemId, randomUUID()),
            parsed.interactor.content,
          )
        : Promise.resolve(null),
    ]);

  assertNoDuplicateWorkspaceFiles(preparedWorkspace);

  const result = await runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    const [existingSets, existingWorkspace] = await Promise.all([
      testcaseSetRepo.withTx(tx).findByProblemId(problem.id),
      problemWorkspaceFileRepo.withTx(tx).findByProblemId(problem.id),
    ]);

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
          inputStorage: t.inputStorage,
        };
        if (t.outputStorage !== null) row.outputStorage = t.outputStorage;
        return row;
      });
      await testcaseRepo.withTx(tx).createMany(rows);
      testcaseCount = preparedTestcases.length;
    }

    if (preparedWorkspace.length > 0) {
      const rows: Prisma.ProblemWorkspaceFileCreateManyInput[] = preparedWorkspace.map(
        (w, i) => ({
          id: w.id,
          contentStorage: w.contentStorage,
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
        ? { checkerLanguage: parsed.checker.language }
        : { checkerLanguage: null }),
      ...(parsed.interactor
        ? {
            interactorLanguage: parsed.interactor.language,
          }
        : { interactorLanguage: null }),
      ...(currentCfg.runtime ? { runtime: currentCfg.runtime } : {}),
    };

    await problemRepo.withTx(tx).update(problem.id, {
      judgeConfig: nextCfg,
      checkerStorage: checkerStorage ?? Prisma.DbNull,
      interactorStorage: interactorStorage ?? Prisma.DbNull,
      activeStorageBytes:
        preparedTestcases.reduce(
          (total, testcase) =>
            total + testcase.inputStorage.size + (testcase.outputStorage?.size ?? 0),
          0,
        ) +
        preparedWorkspace.reduce((total, file) => total + file.contentStorage.size, 0) +
        (checkerStorage?.size ?? 0) +
        (interactorStorage?.size ?? 0),
      storageGeneration: { increment: 1 },
    });
    await commitStoragePointerSwap(tx, {
      added: [
        ...preparedTestcases.flatMap(({ inputStorage, outputStorage }) => [
          inputStorage,
          ...(outputStorage ? [outputStorage] : []),
        ]),
        ...preparedWorkspace.map(({ contentStorage }) => contentStorage),
        ...[checkerStorage, interactorStorage].filter(
          (pointer): pointer is StorageObjectPointer => pointer !== null,
        ),
      ],
      removed: [
        ...existingSets.flatMap(({ testcases }) =>
          testcases.flatMap((testcase) => [
            assertStorageObjectPointer(testcase.inputStorage),
            ...(testcase.outputStorage === null
              ? []
              : [assertStorageObjectPointer(testcase.outputStorage)]),
            ...Object.values((testcase.inputFileStorage ?? {}) as Record<string, unknown>).map(
              assertStorageObjectPointer,
            ),
          ]),
        ),
        ...existingWorkspace.map(({ contentStorage }) =>
          assertStorageObjectPointer(contentStorage),
        ),
        ...[problem.checkerStorage, problem.interactorStorage]
          .filter((pointer) => pointer !== null)
          .map(assertStorageObjectPointer),
      ],
    });

    return {
      id: problem.id,
      testcaseCount,
      workspaceCount: preparedWorkspace.length,
    };
  });

  return result;
}

async function putGuardedText(
  client: Parameters<typeof putImmutableText>[0],
  key: string,
  content: string,
): Promise<StorageObjectPointer> {
  const pointer = storagePointerFor(key, Buffer.from(content, "utf8"));
  await guardStorageObjectWrites([pointer]);
  await putImmutableText(client, key, content);
  return pointer;
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
    inputStorage: unknown;
    outputStorage: unknown;
  }
  const flatTestcases: FlatTestcase[] = [];
  for (const set of sets) {
    for (const tc of set.testcases) {
      flatTestcases.push({
        inputStorage: tc.inputStorage,
        outputStorage: tc.outputStorage,
      });
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
        const input = await getVerifiedText(
          client,
          assertStorageObjectPointer(tc.inputStorage),
        );
        archive.append(input, { name: `testcases/${String(i)}/input.txt` });
        if (tc.outputStorage) {
          const answer = await getVerifiedText(
            client,
            assertStorageObjectPointer(tc.outputStorage),
          );
          archive.append(answer, { name: `testcases/${String(i)}/answer.txt` });
        }
      }
      for (const w of workspaceFiles) {
        const content = await getVerifiedText(
          client,
          assertStorageObjectPointer(w.contentStorage),
        );
        archive.append(content, { name: `workspace/${w.path}` });
      }
      if (problem.checkerStorage && cfg.checkerLanguage) {
        const body = await getVerifiedText(
          client,
          assertStorageObjectPointer(problem.checkerStorage),
        );
        const ext = cfg.checkerLanguage === "python" ? "py" : "cpp";
        archive.append(body, { name: `checker.${ext}` });
      }
      if (problem.interactorStorage && cfg.interactorLanguage) {
        const body = await getVerifiedText(
          client,
          assertStorageObjectPointer(problem.interactorStorage),
        );
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
