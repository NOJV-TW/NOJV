import { runTransaction, testcaseRepo, testcaseSetRepo } from "@nojv/db";
import type { ProblemTestcaseSetCreate, TestcaseSetUpdate, TestcaseUpdate } from "@nojv/core";

import { ConflictError } from "../shared/errors";
import { requireProblem } from "../shared/require";
import { stripUndefined } from "../shared/strip-undefined";

import { assertProblemOwnership, type ProblemActorContext } from "./helpers";

const MAX_TESTCASE_SETS_PER_PROBLEM = 20;

export async function createProblemTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  payload: ProblemTestcaseSetCreate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);

    assertProblemOwnership(problem, actor);

    const existingCount = await tx.testcaseSet.count({
      where: { problemId: problem.id }
    });
    if (existingCount >= MAX_TESTCASE_SETS_PER_PROBLEM) {
      throw new ConflictError(
        `A problem can have at most ${String(MAX_TESTCASE_SETS_PER_PROBLEM)} testcase sets.`
      );
    }

    // TestcaseSet has @@unique([problemId, ordinal]) + ordinal defaults to 0,
    // so every call without an explicit ordinal would collide. Compute the
    // next slot by reading the current max within the transaction.
    const { _max } = await tx.testcaseSet.aggregate({
      where: { problemId: problem.id },
      _max: { ordinal: true }
    });
    const nextOrdinal = (_max.ordinal ?? -1) + 1;

    const testcaseSet = await testcaseSetRepo.withTx(tx).create({
      name: payload.name,
      problemId: problem.id,
      weight: payload.weight,
      ordinal: nextOrdinal
    });

    await testcaseRepo.withTx(tx).createMany(
      payload.cases.map((testcase, index) => ({
        output: testcase.output,
        ordinal: index + 1,
        input: testcase.input,
        testcaseSetId: testcaseSet.id
      }))
    );

    return {
      caseCount: payload.cases.length,
      id: testcaseSet.id,
      name: testcaseSet.name
    };
  });
}

export async function updateTestcaseSetRecord(
  actor: ProblemActorContext,
  problemId: string,
  setId: string,
  payload: TestcaseSetUpdate
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
  setId: string
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    return testcaseSetRepo.delete(setId);
  });
}

export async function updateTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string,
  payload: TestcaseUpdate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    return testcaseRepo.update(testcaseId, stripUndefined(payload));
  });
}

export async function deleteTestcaseRecord(
  actor: ProblemActorContext,
  problemId: string,
  testcaseId: string
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    return testcaseRepo.delete(testcaseId);
  });
}
