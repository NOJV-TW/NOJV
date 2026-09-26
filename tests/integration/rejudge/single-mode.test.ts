import { beforeEach, describe, expect, it, vi } from "vitest";

import { runTransaction, submissionRejudgeLogRepo, submissionRepo } from "@nojv/db";
import { ForbiddenError, submissionDomain } from "@nojv/application";

import {
  createTestContest,
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

beforeEach(() => {
  vi.stubEnv("SANDBOX_IMAGE", "sandbox@sha256:" + "a".repeat(64));
});

describe("rejudge — single-submission domain round trip (real DB)", () => {
  it("writes a SubmissionRejudgeLog capturing old and new verdict/score", async () => {
    const student = await createTestUser();
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });

    const submission = await createTestSubmission({
      userId: student.id,
      problemId: problem.id,
      status: "wrong_answer",
      score: 30,
    });

    const pinned = await submissionDomain.prepareJudgeSnapshot(submission.id, {
      problemId: problem.id,
      language: submission.language,
      sampleOnly: false,
    });
    const execution = await runTransaction((tx) =>
      submissionDomain.createJudgeExecution(tx, {
        submissionId: submission.id,
        ...pinned,
        triggeredByUserId: teacher.id,
      }),
    );

    await submissionDomain.completeJudgeExecution(execution.id, execution.workflowId, {
      accepted: true,
      caseResults: [],
      feedback: "accepted",
      runtimeMs: 1,
      score: 100,
      verdict: "accepted",
    });

    const logs = await submissionRejudgeLogRepo.listBySubmission(submission.id);
    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log.rejudgedByUserId).toBe(teacher.id);
    expect(log.oldVerdict).toBe("wrong_answer");
    expect(log.oldScore).toBe(30);
    expect(log.newVerdict).toBe("accepted");
    expect(log.newScore).toBe(100);
  });

  it("rejects rejudge when actor lacks operate permission", async () => {
    const organizer = await createTestUser({ platformRole: "teacher" });
    const otherTeacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const problem = await createTestProblem({ authorId: organizer.id });
    const contest = await createTestContest({ createdByUserId: organizer.id });

    const submission = await createTestSubmission({
      userId: student.id,
      problemId: problem.id,
      contestId: contest.id,
      status: "wrong_answer",
      score: 0,
    });

    const loaded = await submissionRepo.findById(submission.id);
    expect(loaded).not.toBeNull();

    await expect(
      submissionDomain.assertCanOperateOnSubmission(
        {
          userId: organizer.id,
          username: organizer.username ?? "organizer",
          displayName: organizer.name,
          email: organizer.email,
          platformRole: "teacher",
        },
        loaded!,
      ),
    ).resolves.toBeUndefined();

    await expect(
      submissionDomain.assertCanOperateOnSubmission(
        {
          userId: otherTeacher.id,
          username: otherTeacher.username ?? "other",
          displayName: otherTeacher.name,
          email: otherTeacher.email,
          platformRole: "teacher",
        },
        loaded!,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
