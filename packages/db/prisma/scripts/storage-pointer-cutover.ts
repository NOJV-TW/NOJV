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
const storage = createStorageClient();
const utf8 = new TextDecoder("utf-8", { fatal: true });
const BOOTSTRAP_VERSION = "bootstrap-v1";

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
  const body = await getObject(storage, oldKey);
  const pointer = await putImmutableObject(storage, newKey, body, { contentType });
  const verified = await getVerifiedObject(storage, pointer);
  if (!verified.equals(body)) throw new Error(`Copy verification failed for ${oldKey}`);
  return pointer;
}

async function writeInlineObject(body: string, key: string): Promise<StorageObjectPointer> {
  return putImmutableObject(storage, key, Buffer.from(body, "utf8"), {
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
      const keys = (await listByPrefix(storage, row.sourceStoragePrefix)).sort();
      if (keys.length === 0) {
        throw new Error(`Submission ${row.id} has no source objects to backfill`);
      }
      const sources = await Promise.all(
        keys.map(async (key) => ({
          path: key.slice(row.sourceStoragePrefix.length),
          content: decodeUtf8(await getObject(storage, key), key),
        })),
      );
      const plan = planSubmissionSources(row.id, BOOTSTRAP_VERSION, sources);
      sourceStorage = await putSubmissionSourcePlan(storage, plan);
      await getSubmissionSources(storage, sourceStorage);
    }
    if (verdictDetailStorage === null && row.verdictDetailStorageKey !== null) {
      const oldBody = await getObject(storage, row.verdictDetailStorageKey);
      let detail: unknown;
      try {
        detail = JSON.parse(decodeUtf8(oldBody, row.verdictDetailStorageKey)) as unknown;
      } catch {
        throw new Error(`Submission ${row.id} has malformed legacy verdict JSON`);
      }
      verdictDetailStorage = await putVerdictDetail(storage, row.id, BOOTSTRAP_VERSION, detail);
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
    const body = await getObject(storage, `avatars/${user.id}.webp`);
    const filename = `${BOOTSTRAP_VERSION}.webp`;
    await putImmutableObject(storage, `avatars/${user.id}/${filename}`, body, {
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
    await prisma.problem.update({
      where: { id: problem.id },
      data: { activeStorageBytes: bytes, storageGeneration: { increment: 1 } },
    });
  }
}

async function verify(): Promise<void> {
  const seen = new Set<string>();
  const verifyPointer = async (raw: unknown, owner: string): Promise<number> => {
    const pointer = assertStorageObjectPointer(raw);
    if (seen.has(pointer.key))
      throw new Error(`Storage key is shared by multiple pointers: ${pointer.key}`);
    seen.add(pointer.key);
    await getVerifiedObject(storage, pointer).catch((reason: unknown) => {
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
    for (const pointer of await getSubmissionSourcePointers(storage, manifest)) {
      assertVersionedKey(
        pointer,
        new RegExp(`^submissions/${submission.id}/source-generations/[^/]+/files/`),
        `Submission ${submission.id} source`,
      );
      await verifyPointer(pointer, `Submission ${submission.id} source`);
    }
    await getSubmissionSources(storage, manifest);
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
  await verify();
  console.log(JSON.stringify(result));
}

const command = process.argv[2];
try {
  if (command === "backfill") await backfill();
  else if (command === "verify") await verify();
  else throw new Error("Usage: storage-pointer-cutover.ts <backfill|verify>");
} catch (reason) {
  console.error(reason);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
