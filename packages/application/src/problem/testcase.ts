import { randomUUID } from "node:crypto";

import type { Prisma } from "@nojv/db";
import {
  problemRepo,
  runTransaction,
  testcaseRepo,
  testcaseSetRepo,
  type TransactionClient,
} from "@nojv/db";
import type { ProblemTestcaseSetCreate, TestcaseSetUpdate, TestcaseUpdate } from "@nojv/core";
import { assertStorageObjectPointer, type StorageObjectPointer } from "@nojv/storage";

import { ConflictError, NotFoundError } from "../shared/errors";
import { requireProblem } from "../shared/require";
import { stripUndefined } from "../shared/strip-undefined";
import { commitStoragePointerSwap } from "../shared/storage-object-lifecycle";

import { writeTestcaseField, writeTestcaseBlobs, type TestcaseBlobPointers } from "./blobs";
import {
  assertProblemEditAccess,
  assertProblemOwnership,
  type ProblemActorContext,
} from "./permissions";

const MAX_TESTCASE_SETS_PER_PROBLEM = 20;

async function requireSetInProblem(setId: string, problemId: string, tx?: TransactionClient) {
  const set = tx
    ? await testcaseSetRepo.withTx(tx).findById(setId)
    : await testcaseSetRepo.findById(setId);
  if (set?.problemId !== problemId) {
    throw new NotFoundError("Testcase set not found for this problem.");
  }
  return set;
}

async function requireTestcaseInProblem(
  testcaseId: string,
  problemId: string,
  tx?: TransactionClient,
) {
  const testcase = tx
    ? await testcaseRepo.withTx(tx).findById(testcaseId)
    : await testcaseRepo.findById(testcaseId);
  if (testcase?.testcaseSet.problemId !== problemId) {
    throw new NotFoundError("Testcase not found for this problem.");
  }
  return testcase;
}

export async function createProblemTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemTestcaseSetCreate,
) {
  await assertProblemEditAccess(actor, problemId);

  interface PreparedCase {
    id: string;
    blobPointers: TestcaseBlobPointers;
  }
  const prepared: PreparedCase[] = await Promise.all(
    payload.cases.map(async (tc) => {
      const id = randomUUID();
      const blobPointers = await writeTestcaseBlobs({
        problemId,
        testcaseId: id,
        input: tc.input,
        output: tc.output,
      });
      return { id, blobPointers };
    }),
  );

  return runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    const existingCount = await testcaseSetRepo.withTx(tx).countByProblem(problem.id);
    if (existingCount >= MAX_TESTCASE_SETS_PER_PROBLEM) {
      throw new ConflictError(
        `A problem can have at most ${String(MAX_TESTCASE_SETS_PER_PROBLEM)} testcase sets.`,
      );
    }

    const { _max } = await testcaseSetRepo.withTx(tx).maxOrdinalByProblem(problem.id);
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
        inputStorage: entry.blobPointers.inputStorage,
      };
      if (entry.blobPointers.outputStorage !== null) {
        row.outputStorage = entry.blobPointers.outputStorage;
      }
      if (entry.blobPointers.inputFileStorage !== null) {
        row.inputFileStorage = entry.blobPointers.inputFileStorage;
      }
      return row;
    });
    await testcaseRepo.withTx(tx).createMany(rows);
    await problemRepo.withTx(tx).update(problem.id, {
      activeStorageBytes: {
        increment: prepared.reduce(
          (total, entry) => total + testcasePointersSize(entry.blobPointers),
          0,
        ),
      },
      storageGeneration: { increment: 1 },
    });
    await commitStoragePointerSwap(tx, {
      added: prepared.flatMap(({ blobPointers }) => testcasePointers(blobPointers)),
    });

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
  await assertProblemEditAccess(actor, problemId);

  return runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
    await requireSetInProblem(setId, problem.id, tx);

    return tx.testcaseSet.update({ where: { id: setId }, data: stripUndefined(payload) });
  });
}

export async function deleteTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  setId: string,
) {
  await assertProblemEditAccess(actor, problemId);

  await runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
    const existing = await requireSetInProblem(setId, problemId, tx);
    const bytes = existing.testcases.reduce(
      (total, testcase) => total + persistedTestcaseSize(testcase),
      0,
    );
    await testcaseSetRepo.withTx(tx).delete(setId);
    await problemRepo.withTx(tx).update(problem.id, {
      activeStorageBytes: { decrement: bytes },
      storageGeneration: { increment: 1 },
    });
    await commitStoragePointerSwap(tx, {
      added: [],
      removed: persistedTestcasePointers(existing.testcases),
    });
  });
}

export async function updateTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
  payload: TestcaseUpdate,
) {
  await assertProblemEditAccess(actor, problemId);

  const staged: Partial<Record<"input" | "output", StorageObjectPointer>> = {};
  if (payload.input !== undefined) {
    staged.input = await writeTestcaseField(problemId, testcaseId, "input", payload.input);
  }
  if (payload.output !== undefined) {
    staged.output = await writeTestcaseField(problemId, testcaseId, "output", payload.output);
  }

  await runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
    const testcase = await requireTestcaseInProblem(testcaseId, problem.id, tx);
    const data: Prisma.TestcaseUpdateInput = {};
    const removed: StorageObjectPointer[] = [];
    let deltaBytes = 0;
    if (staged.input) {
      deltaBytes += staged.input.size - assertStorageObjectPointer(testcase.inputStorage).size;
      data.inputStorage = staged.input;
      removed.push(assertStorageObjectPointer(testcase.inputStorage));
    }
    if (staged.output) {
      const previous =
        testcase.outputStorage === null
          ? 0
          : assertStorageObjectPointer(testcase.outputStorage).size;
      deltaBytes += staged.output.size - previous;
      data.outputStorage = staged.output;
      if (testcase.outputStorage !== null) {
        removed.push(assertStorageObjectPointer(testcase.outputStorage));
      }
    }
    if (Object.keys(data).length > 0) {
      await testcaseRepo.withTx(tx).update(testcaseId, data);
      await problemRepo.withTx(tx).update(problem.id, {
        activeStorageBytes: { increment: deltaBytes },
        storageGeneration: { increment: 1 },
      });
      await commitStoragePointerSwap(tx, {
        added: Object.values(staged),
        removed,
      });
    }
  });

  return { id: testcaseId };
}

export async function deleteTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
) {
  await assertProblemEditAccess(actor, problemId);

  await runTransaction(async (tx) => {
    await problemRepo.withTx(tx).lockForUpdate(problemId);
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
    const testcase = await requireTestcaseInProblem(testcaseId, problem.id, tx);

    await testcaseRepo.withTx(tx).delete(testcaseId);
    await problemRepo.withTx(tx).update(problem.id, {
      activeStorageBytes: { decrement: persistedTestcaseSize(testcase) },
      storageGeneration: { increment: 1 },
    });
    await commitStoragePointerSwap(tx, {
      added: [],
      removed: testcasePointersFromRow(testcase),
    });
  });
}

function pointerMapSize(value: unknown): number {
  if (value === null) return 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Persisted testcase input-file storage map is malformed");
  }
  return Object.values(value as Record<string, unknown>).reduce<number>(
    (total, pointer) => total + assertStorageObjectPointer(pointer).size,
    0,
  );
}

function persistedTestcaseSize(testcase: {
  inputStorage: unknown;
  outputStorage: unknown;
  inputFileStorage: unknown;
}): number {
  return (
    assertStorageObjectPointer(testcase.inputStorage).size +
    (testcase.outputStorage === null
      ? 0
      : assertStorageObjectPointer(testcase.outputStorage).size) +
    pointerMapSize(testcase.inputFileStorage)
  );
}

function testcasePointersSize(pointers: TestcaseBlobPointers): number {
  return (
    pointers.inputStorage.size +
    (pointers.outputStorage?.size ?? 0) +
    Object.values(pointers.inputFileStorage ?? {}).reduce(
      (total, pointer) => total + pointer.size,
      0,
    )
  );
}

function testcasePointers(pointers: TestcaseBlobPointers): StorageObjectPointer[] {
  return [
    pointers.inputStorage,
    ...(pointers.outputStorage ? [pointers.outputStorage] : []),
    ...Object.values(pointers.inputFileStorage ?? {}),
  ];
}

function testcasePointersFromRow(testcase: {
  inputStorage: unknown;
  outputStorage: unknown;
  inputFileStorage: unknown;
}): StorageObjectPointer[] {
  const inputFiles =
    testcase.inputFileStorage === null
      ? []
      : Object.values(testcase.inputFileStorage as Record<string, unknown>).map(
          assertStorageObjectPointer,
        );
  return [
    assertStorageObjectPointer(testcase.inputStorage),
    ...(testcase.outputStorage === null
      ? []
      : [assertStorageObjectPointer(testcase.outputStorage)]),
    ...inputFiles,
  ];
}

function persistedTestcasePointers(
  testcases: readonly {
    inputStorage: unknown;
    outputStorage: unknown;
    inputFileStorage: unknown;
  }[],
): StorageObjectPointer[] {
  return testcases.flatMap(testcasePointersFromRow);
}
