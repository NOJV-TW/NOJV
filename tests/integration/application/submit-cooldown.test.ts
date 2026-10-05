import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, submissionDomain, type ActorContext } from "@nojv/application";

import {
  createTestContest,
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

const { createQueuedSubmissionRecord } = submissionDomain;

function actorOf(user: Awaited<ReturnType<typeof createTestUser>>): ActorContext {
  if (!user.username) throw new Error("Actor fixture requires a username.");
  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    displayName: user.name,
    platformRole: user.platformRole,
  };
}

function practiceDraft(problemId: string) {
  return {
    context: { type: "practice" as const },
    problemId,
    language: "python" as const,
    sourceCode: "print(1)",
  };
}

describe("submission cooldown floor (real DB)", () => {
  const previousFloor = process.env.SUBMIT_COOLDOWN_MIN_SEC;

  beforeEach(() => {
    process.env.SUBMIT_COOLDOWN_MIN_SEC = "30";
  });

  afterEach(() => {
    if (previousFloor === undefined) delete process.env.SUBMIT_COOLDOWN_MIN_SEC;
    else process.env.SUBMIT_COOLDOWN_MIN_SEC = previousFloor;
  });

  it("blocks a resubmission of the same problem but not another problem", async () => {
    const student = actorOf(await createTestUser());
    const first = await createTestProblem();
    const second = await createTestProblem();

    await expect(
      createQueuedSubmissionRecord(practiceDraft(first.id), student, "127.0.0.1"),
    ).resolves.toMatchObject({ cooldownSec: 30 });
    await expect(
      createQueuedSubmissionRecord(practiceDraft(first.id), student, "127.0.0.1"),
    ).rejects.toThrow(/Submit cooldown active\. Please wait (29|30) seconds\./);
    await expect(
      createQueuedSubmissionRecord(practiceDraft(second.id), student, "127.0.0.1"),
    ).resolves.toMatchObject({ cooldownSec: 30 });
  });

  it("ignores system errors, reference solutions and submissions from other contexts", async () => {
    const user = await createTestUser();
    const problem = await createTestProblem();
    const contest = await createTestContest();
    await createTestSubmission({
      userId: user.id,
      problemId: problem.id,
      status: "system_error",
    });
    await createTestSubmission({
      userId: user.id,
      problemId: problem.id,
      contestId: contest.id,
    });
    await createTestSubmission({
      userId: user.id,
      problemId: problem.id,
      isReferenceSolution: true,
    });

    await expect(
      createQueuedSubmissionRecord(practiceDraft(problem.id), actorOf(user), "127.0.0.1"),
    ).resolves.toMatchObject({ cooldownSec: 30 });
  });

  it("admits only one of two concurrent submissions to the same problem", async () => {
    const student = actorOf(await createTestUser());
    const problem = await createTestProblem();

    const results = await Promise.allSettled([
      createQueuedSubmissionRecord(practiceDraft(problem.id), student, "127.0.0.1"),
      createQueuedSubmissionRecord(practiceDraft(problem.id), student, "127.0.0.1"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ForbiddenError);
  });
});
