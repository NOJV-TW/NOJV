import { randomUUID } from "node:crypto";

import {
  runTransaction,
  SubtaskScoringStrategy,
  testcaseRepo,
  testcaseSetRepo,
  type Prisma,
} from "@nojv/db";
import type { ProblemTestcaseSetCreate, TestcaseSetUpdate, TestcaseUpdate } from "@nojv/core";

import { ConflictError, ValidationError } from "../shared/errors";
import { requireProblem } from "../shared/require";
import { stripUndefined } from "../shared/strip-undefined";

import {
  bestEffortDeleteTestcaseBlobs,
  overwriteTestcaseField,
  writeTestcaseBlobs,
  type TestcaseBlobKeys,
} from "./blobs";
import {
  assertProblemEditAccess,
  assertProblemOwnership,
  type ProblemActorContext,
} from "./permissions";

const MAX_TESTCASE_SETS_PER_PROBLEM = 20;

export async function createProblemTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemTestcaseSetCreate,
) {
  // 1. Pre-allocate testcase ids so we can compute stable S3 keys, then
  //    upload the blobs OUTSIDE the DB transaction. Upload failure throws
  //    here with zero side effects (no DB rows, no orphan blobs because
  //    PutObject is the only operation that ran).
  interface PreparedCase {
    id: string;
    blobKeys: TestcaseBlobKeys;
  }
  const prepared: PreparedCase[] = await Promise.all(
    payload.cases.map(async (tc) => {
      const id = randomUUID();
      const blobKeys = await writeTestcaseBlobs({
        problemId,
        testcaseId: id,
        input: tc.input,
        output: tc.output,
      });
      return { id, blobKeys };
    }),
  );

  // 2. Now the transaction: ownership check, set creation, and createMany.
  //    The S3 objects already exist; if this transaction rolls back the
  //    blobs become orphans (tolerable per design).
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    const existingCount = await tx.testcaseSet.count({
      where: { problemId: problem.id },
    });
    if (existingCount >= MAX_TESTCASE_SETS_PER_PROBLEM) {
      throw new ConflictError(
        `A problem can have at most ${String(MAX_TESTCASE_SETS_PER_PROBLEM)} testcase sets.`,
      );
    }

    // TestcaseSet has @@unique([problemId, ordinal]) + ordinal defaults to 0,
    // so every call without an explicit ordinal would collide. Compute the
    // next slot by reading the current max within the transaction.
    const { _max } = await tx.testcaseSet.aggregate({
      where: { problemId: problem.id },
      _max: { ordinal: true },
    });
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
        inputKey: entry.blobKeys.inputKey,
      };
      if (entry.blobKeys.outputKey !== null) row.outputKey = entry.blobKeys.outputKey;
      if (entry.blobKeys.inputFileKeys !== null) {
        row.inputFileKeys = entry.blobKeys.inputFileKeys as Prisma.InputJsonValue;
      }
      return row;
    });
    await testcaseRepo.withTx(tx).createMany(rows);

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
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    return testcaseSetRepo.update(setId, stripUndefined(payload));
  });
}

export async function deleteTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  setId: string,
) {
  // Fetch the set's testcase ids first so we know which S3 prefixes to
  // sweep after the DB delete commits. Each testcase has a stable prefix
  // under `problems/{problemId}/testcases/{testcaseId}/` — sweeping the
  // set in one shot would also work, but per-testcase keeps the cleanup
  // surgical and matches the per-row deletion that `deleteTestcase`
  // already does.
  const existing = await testcaseSetRepo.findById(setId);
  const testcaseIds = existing?.testcases.map((tc) => tc.id) ?? [];

  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    await testcaseSetRepo.delete(setId);
  });

  // DB committed — best-effort S3 cleanup. Failure here only leaves
  // orphan objects, which the design accepts.
  await Promise.all(testcaseIds.map((id) => bestEffortDeleteTestcaseBlobs(problemId, id)));
}

export async function updateTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
  payload: TestcaseUpdate,
) {
  // Authorize first so unauthorised callers can't trigger S3 traffic.
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
  });

  // Pure content edit: the row's key columns already point at the
  // correct S3 objects (keys are stable for the lifetime of the row),
  // so we just overwrite the blobs in place — no DB UPDATE required.
  // Touch only the fields that were explicitly provided.
  const writes: Promise<unknown>[] = [];
  if (payload.input !== undefined) {
    writes.push(overwriteTestcaseField(problemId, testcaseId, "input", payload.input));
  }
  if (payload.output !== undefined) {
    writes.push(overwriteTestcaseField(problemId, testcaseId, "output", payload.output));
  }
  await Promise.all(writes);

  return { id: testcaseId };
}

export async function deleteTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
) {
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    await testcaseRepo.delete(testcaseId);
  });

  // DB committed — best-effort S3 cleanup.
  await bestEffortDeleteTestcaseBlobs(problemId, testcaseId);
}

function isSubtaskScoringStrategy(value: string): value is SubtaskScoringStrategy {
  return (Object.values(SubtaskScoringStrategy) as string[]).includes(value);
}

// Validates the raw string against the SubtaskScoringStrategy enum and runs
// the edit-access check before writing. Keeps route handlers out of the
// business of enumerating the enum values themselves.
export async function setTestcaseSetScoringStrategy(
  actor: ProblemActorContext,
  problemId: string,
  setId: string,
  rawStrategy: string,
): Promise<void> {
  if (!isSubtaskScoringStrategy(rawStrategy)) {
    throw new ValidationError("Invalid scoring strategy");
  }
  await assertProblemEditAccess(actor, problemId);
  await testcaseSetRepo.updateScoringStrategy(setId, rawStrategy);
}
