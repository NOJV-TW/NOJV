import { randomUUID } from "node:crypto";

import type { Prisma } from "@nojv/db";
import {
  runTransaction,
  SubtaskScoringStrategy,
  testcaseRepo,
  testcaseSetRepo,
} from "@nojv/db";
import type { ProblemTestcaseSetCreate, TestcaseSetUpdate, TestcaseUpdate } from "@nojv/core";

import { ConflictError, NotFoundError, ValidationError } from "../shared/errors";
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

async function requireSetInProblem(setId: string, problemId: string) {
  const set = await testcaseSetRepo.findById(setId);
  if (set?.problemId !== problemId) {
    throw new NotFoundError("Testcase set not found for this problem.");
  }
  return set;
}

async function requireTestcaseInProblem(testcaseId: string, problemId: string) {
  const testcase = await testcaseRepo.findById(testcaseId);
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

  return runTransaction(async (tx) => {
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
        inputKey: entry.blobKeys.inputKey,
      };
      if (entry.blobKeys.outputKey !== null) row.outputKey = entry.blobKeys.outputKey;
      if (entry.blobKeys.inputFileKeys !== null) {
        row.inputFileKeys = entry.blobKeys.inputFileKeys;
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
    await requireSetInProblem(setId, problem.id);

    return testcaseSetRepo.update(setId, stripUndefined(payload));
  });
}

export async function deleteTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  setId: string,
) {
  const existing = await requireSetInProblem(setId, problemId);
  const testcaseIds = existing.testcases.map((tc) => tc.id);

  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    await testcaseSetRepo.delete(setId);
  });

  await Promise.all(testcaseIds.map((id) => bestEffortDeleteTestcaseBlobs(problemId, id)));
}

export async function updateTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
  payload: TestcaseUpdate,
) {
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);
    await requireTestcaseInProblem(testcaseId, problem.id);
  });

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
    await requireTestcaseInProblem(testcaseId, problem.id);

    await testcaseRepo.delete(testcaseId);
  });

  await bestEffortDeleteTestcaseBlobs(problemId, testcaseId);
}

function isSubtaskScoringStrategy(value: string): value is SubtaskScoringStrategy {
  return (Object.values(SubtaskScoringStrategy) as string[]).includes(value);
}

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
  await requireSetInProblem(setId, problemId);
  await testcaseSetRepo.updateScoringStrategy(setId, rawStrategy);
}
