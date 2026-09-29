import { createHash, randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { submissionDomain as judge } from "@nojv/application";
import { prismaAdapterClient as db, runTransaction } from "@nojv/db";
import { assertStorageObjectPointer } from "@nojv/storage";

import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

beforeEach(() => {
  vi.unstubAllEnvs();
  process.env.SANDBOX_IMAGE = "sandbox@sha256:" + "a".repeat(64);
});

describe("judge snapshot pins", () => {
  it("accepts a submission without reading any testcase object", async () => {
    const user = await createTestUser();
    const problem = await createTestProblem();
    const set = await db.testcaseSet.findFirstOrThrow({ where: { problemId: problem.id } });
    const absent = (name: string) => ({
      key: `problems/${problem.id}/testcases/${name}/versions/${randomUUID()}/input`,
      sha256: createHash("sha256").update(name).digest("hex"),
      size: 1024 * 1024,
    });
    await db.testcase.createMany({
      data: Array.from({ length: 40 }, (_, index) => ({
        id: randomUUID(),
        testcaseSetId: set.id,
        ordinal: index + 2,
        inputStorage: absent(`in-${String(index)}`),
        outputStorage: absent(`out-${String(index)}`),
      })),
    });
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

    expect(assertStorageObjectPointer(execution.snapshot).size).toBeLessThan(1024 * 1024);
    expect(pinned.pins).toHaveLength(82);
    expect(await db.judgeExecutionObject.count({ where: { executionId: execution.id } })).toBe(
      82,
    );
  });
});
