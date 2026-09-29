import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { submissionDomain as judge } from "@nojv/application";
import { prismaAdapterClient as db, runTransaction } from "@nojv/db";
import {
  assertStorageObjectPointer,
  createStorageClient,
  deleteBlob,
  putImmutableObject,
  putImmutableText,
} from "@nojv/storage";

import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

beforeEach(() => {
  vi.unstubAllEnvs();
  process.env.SANDBOX_IMAGE = "sandbox@sha256:" + "a".repeat(64);
});

const client = () => createStorageClient();

async function legacyExecution(state = "completed") {
  const user = await createTestUser();
  const problem = await createTestProblem();
  const submission = await createTestSubmission({
    userId: user.id,
    problemId: problem.id,
    status: "queued",
  });
  const draft = { problemId: problem.id, language: submission.language, sampleOnly: false };
  const pinned = await judge.prepareJudgeSnapshot(submission.id, draft);
  const execution = await runTransaction((tx) =>
    judge.createJudgeExecution(tx, { submissionId: submission.id, ...pinned }),
  );
  const resolved = await judge.readJudgeSnapshot(execution.snapshot);
  const body = Buffer.from(JSON.stringify({ ...resolved, format: 1 }));
  const legacy = await putImmutableObject(
    client(),
    `submissions/${submission.id}/judge-snapshots/${randomUUID()}.json`,
    body,
  );
  await db.judgeExecutionObject.deleteMany({ where: { executionId: execution.id } });
  const updated = await db.judgeExecution.update({
    where: { id: execution.id },
    data: { snapshot: legacy, state },
  });
  return { problem, execution: updated, legacy, resolved };
}

async function pins(executionId: string) {
  return db.judgeExecutionObject.findMany({
    where: { executionId },
    select: { key: true, sha256: true, size: true },
  });
}

describe("judge snapshot compaction", () => {
  it("pins the problem's current testcase objects when their content matches", async () => {
    const { problem, execution, legacy, resolved } = await legacyExecution();
    const testcase = await db.testcase.findFirstOrThrow({
      where: { testcaseSet: { problemId: problem.id } },
    });

    const result = await judge.compactJudgeSnapshot(execution.id);

    expect(result).toMatchObject({ outcome: "compacted", uploads: 0 });
    expect(await pins(execution.id)).toEqual(
      expect.arrayContaining([testcase.inputStorage, testcase.outputStorage]),
    );
    const after = await db.judgeExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(assertStorageObjectPointer(after.snapshot).key).not.toBe(legacy.key);
    expect(await judge.readJudgeSnapshot(after.snapshot)).toEqual(resolved);
    const cleanup = await db.durableWork.findMany({
      where: { kind: "storage.object.cleanup", status: "pending" },
    });
    expect(cleanup.map((work) => work.payload)).toContainEqual({ pointer: legacy });
  });

  it("recreates testcase versions whose objects were already deleted", async () => {
    const { problem, execution, resolved } = await legacyExecution();
    const testcase = await db.testcase.findFirstOrThrow({
      where: { testcaseSet: { problemId: problem.id } },
    });
    const replacement = await putImmutableText(
      client(),
      `problems/${problem.id}/testcases/${testcase.id}/versions/${randomUUID()}/input`,
      "5 6",
    );
    await db.testcase.update({
      where: { id: testcase.id },
      data: { inputStorage: replacement, outputStorage: replacement },
    });
    await deleteBlob(client(), assertStorageObjectPointer(testcase.inputStorage).key);
    await deleteBlob(client(), assertStorageObjectPointer(testcase.outputStorage).key);

    const result = await judge.compactJudgeSnapshot(execution.id);

    expect(result).toMatchObject({ outcome: "compacted", uploads: 2 });
    const pinned = await pins(execution.id);
    expect(
      pinned.every(({ key }) => key.startsWith(`problems/${problem.id}/pinned-testcases/`)),
    ).toBe(true);
    const after = await db.judgeExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(await judge.readJudgeSnapshot(after.snapshot)).toEqual(resolved);
    expect(await judge.compactJudgeSnapshot(execution.id)).toEqual({
      outcome: "already_compact",
    });
  });

  it("leaves active executions alone", async () => {
    const { execution, legacy } = await legacyExecution("running");
    expect(await judge.compactJudgeSnapshot(execution.id)).toEqual({
      outcome: "skipped_active",
    });
    const after = await db.judgeExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(after.snapshot).toEqual(legacy);
  });

  it("reports without writing on a dry run", async () => {
    const { execution, legacy } = await legacyExecution();
    const result = await judge.compactJudgeSnapshot(execution.id, { dryRun: true });
    expect(result).toMatchObject({ outcome: "would_compact", uploads: 0 });
    const after = await db.judgeExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(after.snapshot).toEqual(legacy);
    expect(await pins(execution.id)).toEqual([]);
  });

  it("lists terminal executions whose snapshot exceeds the size floor", async () => {
    const { execution } = await legacyExecution();
    const { execution: active } = await legacyExecution("running");
    const listed = await judge.listCompactionCandidates({ limit: 1000, minBytes: 0 });
    expect(listed).toContain(execution.id);
    expect(listed).not.toContain(active.id);
    expect(
      await judge.listCompactionCandidates({ limit: 1000, minBytes: 1 << 30 }),
    ).not.toContain(execution.id);
  });
});
