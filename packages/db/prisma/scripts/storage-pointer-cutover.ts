#!/usr/bin/env node
import { PrismaPg } from "@prisma/adapter-pg";
import {
  assertStorageObjectPointer,
  checkerKey,
  createStorageClient,
  getObject,
  getSubmissionSourcePointers,
  getSubmissionSources,
  getVerifiedObject,
  interactorKey,
  listByPrefix,
  planSubmissionSources,
  putImmutableObject,
  putSubmissionSourcePlan,
  putVerdictDetail,
  testcaseInputFileKey,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
  type StorageObjectPointer,
} from "@nojv/storage";

import { PrismaClient, Prisma } from "../../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const command = process.argv[2];
const storage = command === "backfill" || command === "verify" ? createStorageClient() : null;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const BOOTSTRAP_VERSION = "bootstrap-v1";
const CONTRACT_MIGRATION = "20260716000012_versioned_blob_pointers_contract";

function getStorage() {
  if (!storage) throw new Error(`S3 is not available for the ${command ?? "unknown"} command`);
  return storage;
}

interface LegacyTestcase {
  id: string;
  problemId: string;
  inputKey: string;
  outputKey: string | null;
  inputFileKeys: unknown;
  inputStorage: unknown;
}

interface LegacyWorkspaceFile {
  id: string;
  problemId: string;
  contentKey: string;
  contentStorage: unknown;
}

interface LegacyProblem {
  id: string;
  judgeConfig: unknown;
  checkerStorage: unknown;
  interactorStorage: unknown;
}

interface LegacySubmission {
  id: string;
  sourceStoragePrefix: string;
  verdictDetailStorageKey: string | null;
  sourceStorage: unknown;
  verdictDetailStorage: unknown;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asLegacyKeyMap(value: unknown, owner: string): Record<string, string> | null {
  if (value === null) return null;
  const record = asObject(value);
  for (const [name, key] of Object.entries(record)) {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error(`${owner} has malformed legacy key for ${name}`);
    }
  }
  return record as Record<string, string>;
}

async function copyLegacyObject(
  oldKey: string,
  newKey: string,
  contentType = "text/plain; charset=utf-8",
): Promise<StorageObjectPointer> {
  const client = getStorage();
  const body = await getObject(client, oldKey);
  const pointer = await putImmutableObject(client, newKey, body, { contentType });
  const verified = await getVerifiedObject(client, pointer);
  if (!verified.equals(body)) throw new Error(`Copy verification failed for ${oldKey}`);
  return pointer;
}

async function writeInlineObject(body: string, key: string): Promise<StorageObjectPointer> {
  return putImmutableObject(getStorage(), key, Buffer.from(body, "utf8"), {
    contentType: "text/plain; charset=utf-8",
  });
}

async function backfillTestcases(): Promise<number> {
  const rows = await prisma.$queryRaw<LegacyTestcase[]>`
    SELECT
      testcase.id,
      testcase_set."problemId",
      testcase."inputKey",
      testcase."outputKey",
      testcase."inputFileKeys",
      testcase."inputStorage"
    FROM "Testcase" AS testcase
    JOIN "TestcaseSet" AS testcase_set ON testcase_set.id = testcase."testcaseSetId"
    ORDER BY testcase.id
  `;
  let changed = 0;
  for (const row of rows) {
    if (row.inputStorage !== null) continue;
    const version = BOOTSTRAP_VERSION;
    const legacyFiles = asLegacyKeyMap(row.inputFileKeys, `Testcase ${row.id}`);
    const [inputStorage, outputStorage, inputFileEntries] = await Promise.all([
      copyLegacyObject(row.inputKey, testcaseInputKey(row.problemId, row.id, version)),
      row.outputKey
        ? copyLegacyObject(row.outputKey, testcaseOutputKey(row.problemId, row.id, version))
        : Promise.resolve(null),
      Promise.all(
        Object.entries(legacyFiles ?? {}).map(
          async ([name, oldKey]) =>
            [
              name,
              await copyLegacyObject(
                oldKey,
                testcaseInputFileKey(row.problemId, row.id, version, name),
              ),
            ] as const,
        ),
      ),
    ]);
    await prisma.testcase.update({
      where: { id: row.id },
      data: {
        inputStorage,
        outputStorage: outputStorage ?? Prisma.DbNull,
        inputFileStorage:
          inputFileEntries.length === 0 ? Prisma.DbNull : Object.fromEntries(inputFileEntries),
      },
    });
    changed += 1;
  }
  return changed;
}

async function backfillWorkspace(): Promise<number> {
  const rows = await prisma.$queryRaw<LegacyWorkspaceFile[]>`
    SELECT id, "problemId", "contentKey", "contentStorage"
    FROM "ProblemWorkspaceFile"
    ORDER BY id
  `;
  let changed = 0;
  for (const row of rows) {
    if (row.contentStorage !== null) continue;
    const contentStorage = await copyLegacyObject(
      row.contentKey,
      workspaceFileKey(row.problemId, row.id, BOOTSTRAP_VERSION),
    );
    await prisma.problemWorkspaceFile.update({
      where: { id: row.id },
      data: { contentStorage },
    });
    changed += 1;
  }
  return changed;
}

async function validatorPointer(
  problemId: string,
  role: "checker" | "interactor",
  config: Record<string, unknown>,
): Promise<StorageObjectPointer | null> {
  const inline = config[`${role}Script`];
  const oldKey = config[`${role}Key`];
  const newKey =
    role === "checker"
      ? checkerKey(problemId, BOOTSTRAP_VERSION)
      : interactorKey(problemId, BOOTSTRAP_VERSION);
  if (typeof inline === "string" && inline.trim().length > 0) {
    return writeInlineObject(inline, newKey);
  }
  if (typeof oldKey === "string" && oldKey.length > 0) {
    return copyLegacyObject(oldKey, newKey);
  }
  return null;
}

async function backfillValidators(): Promise<number> {
  const rows = await prisma.$queryRaw<LegacyProblem[]>`
    SELECT id, "judgeConfig", "checkerStorage", "interactorStorage"
    FROM "Problem"
    ORDER BY id
  `;
  let changed = 0;
  for (const row of rows) {
    const config = asObject(row.judgeConfig);
    const hasLegacy = ["checkerKey", "interactorKey", "checkerScript", "interactorScript"].some(
      (key) => key in config,
    );
    if (!hasLegacy && row.checkerStorage !== null && row.interactorStorage !== null) continue;
    const [checkerStorage, interactorStorage] = await Promise.all([
      row.checkerStorage === null
        ? validatorPointer(row.id, "checker", config)
        : Promise.resolve(assertStorageObjectPointer(row.checkerStorage)),
      row.interactorStorage === null
        ? validatorPointer(row.id, "interactor", config)
        : Promise.resolve(assertStorageObjectPointer(row.interactorStorage)),
    ]);
    const {
      checkerKey: _checkerKey,
      interactorKey: _interactorKey,
      checkerScript: _checkerScript,
      interactorScript: _interactorScript,
      ...judgeConfig
    } = config;
    await prisma.problem.update({
      where: { id: row.id },
      data: {
        judgeConfig: judgeConfig as Prisma.InputJsonObject,
        checkerStorage: checkerStorage ?? Prisma.DbNull,
        interactorStorage: interactorStorage ?? Prisma.DbNull,
      },
    });
    changed += 1;
  }
  return changed;
}

function decodeUtf8(body: Buffer, key: string): string {
  try {
    return utf8.decode(body);
  } catch {
    throw new Error(`Legacy submission source is not valid UTF-8: ${key}`);
  }
}

async function backfillSubmissions(): Promise<number> {
  const rows = await prisma.$queryRaw<LegacySubmission[]>`
    SELECT
      id,
      "sourceStoragePrefix",
      "verdictDetailStorageKey",
      "sourceStorage",
      "verdictDetailStorage"
    FROM "Submission"
    ORDER BY id
  `;
  let changed = 0;
  for (const row of rows) {
    let sourceStorage =
      row.sourceStorage === null ? null : assertStorageObjectPointer(row.sourceStorage);
    let verdictDetailStorage =
      row.verdictDetailStorage === null
        ? null
        : assertStorageObjectPointer(row.verdictDetailStorage);
    if (sourceStorage === null) {
      const client = getStorage();
      const keys = (await listByPrefix(client, row.sourceStoragePrefix)).sort();
      if (keys.length === 0) {
        throw new Error(`Submission ${row.id} has no source objects to backfill`);
      }
      const sources = await Promise.all(
        keys.map(async (key) => ({
          path: key.slice(row.sourceStoragePrefix.length),
          content: decodeUtf8(await getObject(client, key), key),
        })),
      );
      const plan = planSubmissionSources(row.id, BOOTSTRAP_VERSION, sources);
      sourceStorage = await putSubmissionSourcePlan(client, plan);
      await getSubmissionSources(client, sourceStorage);
    }
    if (verdictDetailStorage === null && row.verdictDetailStorageKey !== null) {
      const client = getStorage();
      const oldBody = await getObject(client, row.verdictDetailStorageKey);
      let detail: unknown;
      try {
        detail = JSON.parse(decodeUtf8(oldBody, row.verdictDetailStorageKey)) as unknown;
      } catch {
        throw new Error(`Submission ${row.id} has malformed legacy verdict JSON`);
      }
      verdictDetailStorage = await putVerdictDetail(client, row.id, BOOTSTRAP_VERSION, detail);
    }
    await prisma.submission.update({
      where: { id: row.id },
      data: {
        sourceStorage,
        verdictDetailStorage: verdictDetailStorage ?? Prisma.DbNull,
      },
    });
    changed += 1;
  }
  return changed;
}

async function backfillAvatars(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { image: { startsWith: "/api/storage/avatars/" } },
    select: { id: true, image: true },
    orderBy: { id: "asc" },
  });
  let changed = 0;
  for (const user of users) {
    if (!user.image || user.image.includes(`/${user.id}/`)) continue;
    const legacyPath = new URL(user.image, "http://localhost").pathname;
    if (legacyPath !== `/api/storage/avatars/${encodeURIComponent(user.id)}`) {
      throw new Error(`User ${user.id} has an unrecognized internal avatar URL`);
    }
    const client = getStorage();
    const body = await getObject(client, `avatars/${user.id}.webp`);
    const filename = `${BOOTSTRAP_VERSION}.webp`;
    await putImmutableObject(client, `avatars/${user.id}/${filename}`, body, {
      contentType: "image/webp",
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { image: `/api/storage/avatars/${encodeURIComponent(user.id)}/${filename}` },
    });
    changed += 1;
  }
  return changed;
}

function pointerSize(value: unknown): number {
  return assertStorageObjectPointer(value).size;
}

function pointerMapSize(value: unknown): number {
  if (value === null) return 0;
  const record = asObject(value);
  return Object.values(record).reduce<number>(
    (total, pointer) => total + pointerSize(pointer),
    0,
  );
}

async function refreshProblemAccounting(): Promise<void> {
  const problems = await prisma.problem.findMany({
    select: {
      id: true,
      storageGeneration: true,
      activeStorageBytes: true,
      checkerStorage: true,
      interactorStorage: true,
      testcaseSets: {
        select: {
          testcases: {
            select: { inputStorage: true, outputStorage: true, inputFileStorage: true },
          },
        },
      },
      workspaceFiles: { select: { contentStorage: true } },
    },
  });
  for (const problem of problems) {
    const bytes =
      (problem.checkerStorage === null ? 0 : pointerSize(problem.checkerStorage)) +
      (problem.interactorStorage === null ? 0 : pointerSize(problem.interactorStorage)) +
      problem.workspaceFiles.reduce(
        (total, file) => total + pointerSize(file.contentStorage),
        0,
      ) +
      problem.testcaseSets.reduce(
        (total, set) =>
          total +
          set.testcases.reduce(
            (caseTotal, testcase) =>
              caseTotal +
              pointerSize(testcase.inputStorage) +
              (testcase.outputStorage === null ? 0 : pointerSize(testcase.outputStorage)) +
              pointerMapSize(testcase.inputFileStorage),
            0,
          ),
        0,
      );
    if (problem.activeStorageBytes !== bytes || problem.storageGeneration === 0) {
      await prisma.problem.update({
        where: { id: problem.id },
        data: {
          activeStorageBytes: bytes,
          ...(problem.storageGeneration === 0 ? { storageGeneration: 1 } : {}),
        },
      });
    }
  }
}

async function verify(): Promise<void> {
  const seen = new Set<string>();
  const verifyPointer = async (raw: unknown, owner: string): Promise<number> => {
    const pointer = assertStorageObjectPointer(raw);
    if (seen.has(pointer.key))
      throw new Error(`Storage key is shared by multiple pointers: ${pointer.key}`);
    seen.add(pointer.key);
    await getVerifiedObject(getStorage(), pointer).catch((reason: unknown) => {
      throw new Error(`${owner}: ${reason instanceof Error ? reason.message : String(reason)}`);
    });
    return pointer.size;
  };
  const assertVersionedKey = (
    pointer: StorageObjectPointer,
    pattern: RegExp,
    owner: string,
  ): void => {
    if (!pattern.test(pointer.key)) {
      throw new Error(`${owner} has a non-versioned storage key: ${pointer.key}`);
    }
  };

  const problems = await prisma.problem.findMany({
    include: { testcaseSets: { include: { testcases: true } }, workspaceFiles: true },
  });
  for (const problem of problems) {
    const config = asObject(problem.judgeConfig);
    for (const key of ["checkerKey", "interactorKey", "checkerScript", "interactorScript"]) {
      if (key in config) throw new Error(`Problem ${problem.id} still has legacy ${key}`);
    }
    let bytes = 0;
    if (problem.checkerStorage !== null) {
      const pointer = assertStorageObjectPointer(problem.checkerStorage);
      assertVersionedKey(
        pointer,
        new RegExp(`^problems/${problem.id}/validators/[^/]+/checker$`),
        `Problem ${problem.id} checker`,
      );
      bytes += await verifyPointer(pointer, `Problem ${problem.id} checker`);
    }
    if (problem.interactorStorage !== null) {
      const pointer = assertStorageObjectPointer(problem.interactorStorage);
      assertVersionedKey(
        pointer,
        new RegExp(`^problems/${problem.id}/validators/[^/]+/interactor$`),
        `Problem ${problem.id} interactor`,
      );
      bytes += await verifyPointer(pointer, `Problem ${problem.id} interactor`);
    }
    for (const file of problem.workspaceFiles) {
      const pointer = assertStorageObjectPointer(file.contentStorage);
      assertVersionedKey(
        pointer,
        new RegExp(`^problems/${problem.id}/workspace/${file.id}/versions/[^/]+$`),
        `Workspace ${file.id}`,
      );
      bytes += await verifyPointer(pointer, `Workspace ${file.id}`);
    }
    for (const set of problem.testcaseSets) {
      for (const testcase of set.testcases) {
        const inputPointer = assertStorageObjectPointer(testcase.inputStorage);
        assertVersionedKey(
          inputPointer,
          new RegExp(`^problems/${problem.id}/testcases/${testcase.id}/versions/[^/]+/input$`),
          `Testcase ${testcase.id} input`,
        );
        bytes += await verifyPointer(inputPointer, `Testcase ${testcase.id} input`);
        if (testcase.outputStorage !== null) {
          const outputPointer = assertStorageObjectPointer(testcase.outputStorage);
          assertVersionedKey(
            outputPointer,
            new RegExp(
              `^problems/${problem.id}/testcases/${testcase.id}/versions/[^/]+/output$`,
            ),
            `Testcase ${testcase.id} output`,
          );
          bytes += await verifyPointer(outputPointer, `Testcase ${testcase.id} output`);
        }
        for (const [name, pointer] of Object.entries(asObject(testcase.inputFileStorage))) {
          bytes += await verifyPointer(pointer, `Testcase ${testcase.id} file ${name}`);
        }
      }
    }
    if (bytes !== problem.activeStorageBytes) {
      throw new Error(
        `Problem ${problem.id} accounting mismatch: ${String(problem.activeStorageBytes)} != ${String(bytes)}`,
      );
    }
  }

  const submissions = await prisma.submission.findMany({ orderBy: { id: "asc" } });
  for (const submission of submissions) {
    const manifest = assertStorageObjectPointer(submission.sourceStorage);
    assertVersionedKey(
      manifest,
      new RegExp(`^submissions/${submission.id}/source-generations/[^/]+/manifest\\.json$`),
      `Submission ${submission.id} source manifest`,
    );
    await verifyPointer(manifest, `Submission ${submission.id} source manifest`);
    for (const pointer of await getSubmissionSourcePointers(getStorage(), manifest)) {
      assertVersionedKey(
        pointer,
        new RegExp(`^submissions/${submission.id}/source-generations/[^/]+/files/`),
        `Submission ${submission.id} source`,
      );
      await verifyPointer(pointer, `Submission ${submission.id} source`);
    }
    await getSubmissionSources(getStorage(), manifest);
    if (submission.verdictDetailStorage !== null) {
      const pointer = assertStorageObjectPointer(submission.verdictDetailStorage);
      assertVersionedKey(
        pointer,
        new RegExp(`^submissions/${submission.id}/judge-runs/[^/]+/verdict-detail\\.json$`),
        `Submission ${submission.id} verdict`,
      );
      await verifyPointer(pointer, `Submission ${submission.id} verdict`);
    }
  }

  const invalidAvatar = await prisma.user.findFirst({
    where: {
      image: { startsWith: "/api/storage/avatars/" },
      NOT: { image: { contains: ".webp" } },
    },
    select: { id: true },
  });
  if (invalidAvatar) throw new Error(`User ${invalidAvatar.id} still has a legacy avatar URL`);
  console.log(`Verified ${String(seen.size)} immutable storage pointers.`);
}

async function backfill(): Promise<void> {
  const result = {
    testcases: await backfillTestcases(),
    workspace: await backfillWorkspace(),
    validators: await backfillValidators(),
    submissions: await backfillSubmissions(),
    avatars: await backfillAvatars(),
  };
  await refreshProblemAccounting();
  console.log(JSON.stringify(result));
}

async function preflight(): Promise<void> {
  const rows = await prisma.$queryRaw<
    {
      invalidTestcases: bigint;
      invalidWorkspace: bigint;
      invalidSubmissions: bigint;
      invalidProblems: bigint;
    }[]
  >`
    SELECT
      (
        SELECT count(*)
        FROM "Testcase"
        WHERE NOT "storage_pointer_valid"("inputStorage")
           OR ("outputKey" IS NOT NULL AND NOT "storage_pointer_valid"("outputStorage"))
           OR ("outputKey" IS NULL AND "outputStorage" IS NOT NULL)
           OR (
             "inputFileKeys" IS NOT NULL
             AND NOT "storage_pointer_map_valid"("inputFileStorage")
           )
           OR ("inputFileKeys" IS NULL AND "inputFileStorage" IS NOT NULL)
      ) AS "invalidTestcases",
      (
        SELECT count(*)
        FROM "ProblemWorkspaceFile"
        WHERE NOT "storage_pointer_valid"("contentStorage")
      ) AS "invalidWorkspace",
      (
        SELECT count(*)
        FROM "Submission"
        WHERE NOT "storage_pointer_valid"("sourceStorage")
           OR (
             "verdictDetailStorageKey" IS NOT NULL
             AND NOT "storage_pointer_valid"("verdictDetailStorage")
           )
           OR (
             "verdictDetailStorageKey" IS NULL
             AND "verdictDetailStorage" IS NOT NULL
           )
      ) AS "invalidSubmissions",
      (
        SELECT count(*)
        FROM "Problem"
        WHERE ("checkerStorage" IS NOT NULL AND NOT "storage_pointer_valid"("checkerStorage"))
           OR (
             "interactorStorage" IS NOT NULL
             AND NOT "storage_pointer_valid"("interactorStorage")
           )
           OR "judgeConfig" ?| ARRAY[
             'checkerKey',
             'interactorKey',
             'checkerScript',
             'interactorScript'
           ]
      ) AS "invalidProblems"
  `;
  const counts = rows[0];
  if (!counts) throw new Error("Storage pointer database preflight returned no result");

  if (Object.values(counts).some((count) => count > 0n)) {
    throw new Error(
      `Versioned storage pointer cutover blocked: testcase=${String(counts.invalidTestcases)}, workspace=${String(counts.invalidWorkspace)}, submission=${String(counts.invalidSubmissions)}, problem=${String(counts.invalidProblems)}.`,
    );
  }
  console.log("Storage pointer database preflight passed.");
}

async function contractStatus(): Promise<void> {
  const rows = await prisma.$queryRaw<
    { applied: boolean; failed: boolean; legacyColumns: bigint }[]
  >`
    SELECT
      EXISTS (
        SELECT 1
        FROM "_prisma_migrations"
        WHERE migration_name = ${CONTRACT_MIGRATION}
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      ) AS applied,
      EXISTS (
        SELECT 1
        FROM "_prisma_migrations"
        WHERE migration_name = ${CONTRACT_MIGRATION}
          AND finished_at IS NULL
          AND rolled_back_at IS NULL
      ) AS failed,
      (
        SELECT count(*)
        FROM (
          VALUES
            ('Testcase', 'inputKey'),
            ('Testcase', 'outputKey'),
            ('Testcase', 'inputFileKeys'),
            ('ProblemWorkspaceFile', 'contentKey'),
            ('Submission', 'sourceStoragePrefix'),
            ('Submission', 'verdictDetailStorageKey')
        ) AS legacy(table_name, column_name)
        JOIN information_schema.columns AS actual
          ON actual.table_schema = current_schema()
         AND actual.table_name = legacy.table_name
         AND actual.column_name = legacy.column_name
      ) AS "legacyColumns"
  `;
  const status = rows[0];
  if (status?.applied && !status.failed && status.legacyColumns === 0n) console.log("applied");
  else if (!status?.applied && status?.failed && status.legacyColumns === 6n)
    console.log("recoverable");
  else if (!status?.applied && !status?.failed && status?.legacyColumns === 6n)
    console.log("pending");
  else console.log("unsafe");
}

try {
  if (command === "backfill") await backfill();
  else if (command === "verify") await verify();
  else if (command === "preflight") await preflight();
  else if (command === "status") await contractStatus();
  else throw new Error("Usage: storage-pointer-cutover.ts <backfill|verify|preflight|status>");
} catch (reason) {
  console.error(reason);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
