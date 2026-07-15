import { describe, expect, it } from "vitest";

import { submissionRejudgeLogRepo, submissionRepo } from "@nojv/db";
import { ForbiddenError, submissionDomain } from "@nojv/application";

import {
  createTestContest,
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

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

    const judgeRunId = `run-${submission.id}`;
    const snap = await submissionDomain.snapshotForRejudge(
      submission.id,
      teacher.id,
      judgeRunId,
    );
    expect(snap).not.toBeNull();

    await submissionDomain.completeJudge(submission.id, judgeRunId, {
      accepted: true,
      caseResults: [],
      feedback: "accepted",
      runtimeMs: 1,
      score: 100,
      verdict: "accepted",
    });

    await submissionDomain.finalizeRejudgeLog(
      submission.id,
      teacher.id,
      snap!.logId,
      judgeRunId,
    );

    const logs = await submissionRejudgeLogRepo.listBySubmission(submission.id);
    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log.rejudgedByUserId).toBe(teacher.id);
    expect(log.oldVerdict).toBe("wrong_answer");
    expect(log.oldScore).toBe(30);
    expect(log.newVerdict).toBe("accepted");
    expect(log.newScore).toBe(100);
  });

  it("snapshotForRejudge is idempotent per run id — a retry reuses the first capture", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });
    const submission = await createTestSubmission({
      problemId: problem.id,
      status: "wrong_answer",
      score: 30,
    });

    const first = await submissionDomain.snapshotForRejudge(
      submission.id,
      teacher.id,
      "run-retry",
    );
    expect(first?.oldStatus).toBe("wrong_answer");

    await submissionRepo.complete(submission.id, { status: "accepted", score: 100 });

    const retry = await submissionDomain.snapshotForRejudge(
      submission.id,
      teacher.id,
      "run-retry",
    );

    expect(retry!.logId).toBe(first!.logId);
    expect(retry!.oldStatus).toBe("wrong_answer");

    const logs = await submissionRejudgeLogRepo.listBySubmission(submission.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.oldVerdict).toBe("wrong_answer");
    expect(logs[0]!.oldScore).toBe(30);
  });

  it("starts automatic recovery only while the locked SE generation still matches", async () => {
    const submission = await createTestSubmission({ status: "system_error" });

    await expect(
      submissionDomain.snapshotForRejudge(submission.id, null, "stale-recovery", 1),
    ).resolves.toBeNull();
    await expect(
      submissionDomain.snapshotForRejudge(submission.id, null, "current-recovery", 0),
    ).resolves.toMatchObject({ oldStatus: "system_error" });

    const updated = await submissionRepo.findById(submission.id);
    expect(updated).toMatchObject({
      activeJudgeRunId: "current-recovery",
      judgeGeneration: 1,
      status: "running",
    });
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
