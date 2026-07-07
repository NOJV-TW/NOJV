import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { terminateSubmissionJudge, describeSubmissionJudge } = vi.hoisted(() => ({
  terminateSubmissionJudge: vi.fn(),
  describeSubmissionJudge: vi.fn(),
}));

import { submissionRejudgeLogRepo, submissionRepo } from "@nojv/db";
import { configureDomainOrchestration, submissionDomain } from "@nojv/application";

import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function backdateUpdatedAt(submissionId: string, minutesAgo: number) {
  const ts = new Date(Date.now() - minutesAgo * 60_000);
  await testPrisma.$executeRaw`UPDATE "Submission" SET "updatedAt" = ${ts} WHERE "id" = ${submissionId}`;
}

beforeEach(() => {
  terminateSubmissionJudge.mockReset();
  describeSubmissionJudge.mockReset();
  describeSubmissionJudge.mockResolvedValue(null);
  configureDomainOrchestration({
    cancelRejudge: vi.fn(async () => {}),
    describeSubmissionJudge,
    dispatchAssignmentDueSoon: vi.fn(async () => {}),
    dispatchContestLifecycle: vi.fn(async () => {}),
    dispatchExamAutoClose: vi.fn(async () => {}),
    dispatchPlagiarismCheck: vi.fn(async () => {}),
    dispatchRejudge: vi.fn(async () => ({ workflowId: "rejudge-test" })),
    dispatchSubmissionJudge: vi.fn(async () => {}),
    getRejudgeTriggeredBy: vi.fn(async () => null),
    probeTemporal: vi.fn(async () => {}),
    queryRejudgeProgress: vi.fn(async () => ({ completed: 0, total: 0 })),
    terminateSubmissionJudge,
  });
});

describe("attempt count excludes system_error (real DB)", () => {
  it("does not count system_error submissions toward the daily attempt limit", async () => {
    const student = await createTestUser();
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assignment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "Sweep HW",
        summary: "homework summary text",
        status: "published",
        opensAt: new Date("2026-01-01T00:00:00.000Z"),
        closesAt: new Date("2027-01-01T00:00:00.000Z"),
        maxAttemptsPerDay: 3,
        attemptResetMinuteOfDay: 0,
      },
    });

    const common = {
      userId: student.id,
      problemId: problem.id,
      courseId: course.id,
      assessmentId: assignment.id,
    };
    await createTestSubmission({ ...common, status: "wrong_answer", score: 30 });
    await createTestSubmission({ ...common, status: "system_error", score: 0 });

    const windowStart = submissionDomain.attemptWindowStart(0, new Date());
    const count = await submissionRepo.countForUserAssessmentProblemSince(
      student.id,
      assignment.id,
      problem.id,
      windowStart,
    );
    expect(count).toBe(1);
  });
});

describe("sweepStaleSubmissions (real DB)", () => {
  it("kills stale pending submissions and leaves fresh or terminal ones alone", async () => {
    const stale = await createTestSubmission({ status: "queued" });
    const fresh = await createTestSubmission({ status: "running" });
    const terminal = await createTestSubmission({ status: "accepted" });
    await backdateUpdatedAt(stale.id, 60);
    await backdateUpdatedAt(terminal.id, 60);

    const result = await submissionDomain.sweepStaleSubmissions();

    expect(terminateSubmissionJudge).toHaveBeenCalledWith(stale.id, expect.any(String));
    expect(result.killed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const [staleRow, freshRow, terminalRow] = await Promise.all([
      submissionRepo.findById(stale.id),
      submissionRepo.findById(fresh.id),
      submissionRepo.findById(terminal.id),
    ]);
    expect(staleRow?.status).toBe("system_error");
    expect(freshRow?.status).toBe("running");
    expect(terminalRow?.status).toBe("accepted");
  });

  it("skips a stale row whose judge workflow is still RUNNING (backlog, not a hang)", async () => {
    describeSubmissionJudge.mockResolvedValue({ status: "RUNNING", running: true });
    const stale = await createTestSubmission({ status: "running" });
    await backdateUpdatedAt(stale.id, 60);

    const result = await submissionDomain.sweepStaleSubmissions();

    expect(terminateSubmissionJudge).not.toHaveBeenCalled();
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const row = await submissionRepo.findById(stale.id);
    expect(row?.status).toBe("running");
  });

  it("uses the timeout threshold from the environment", async () => {
    const previous = process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES;
    process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES = "10";
    try {
      const beyondCustom = await createTestSubmission({ status: "queued" });
      await backdateUpdatedAt(beyondCustom.id, 15);

      await submissionDomain.sweepStaleSubmissions();

      const row = await submissionRepo.findById(beyondCustom.id);
      expect(row?.status).toBe("system_error");
    } finally {
      if (previous === undefined) delete process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES;
      else process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES = previous;
    }
  });

  it("skips marking when workflow termination fails", async () => {
    terminateSubmissionJudge.mockRejectedValueOnce(new Error("temporal unreachable"));
    const stale = await createTestSubmission({ status: "compiling" });
    await backdateUpdatedAt(stale.id, 60);

    const result = await submissionDomain.sweepStaleSubmissions();

    expect(result.failed).toBeGreaterThanOrEqual(1);
    const row = await submissionRepo.findById(stale.id);
    expect(row?.status).toBe("compiling");
  });

  it("prunes rejudge logs past the retention window and keeps recent ones", async () => {
    const submission = await createTestSubmission({ status: "accepted" });
    const oldLog = await submissionRejudgeLogRepo.create({
      submissionId: submission.id,
      rejudgedByUserId: null,
      rejudgeRunId: null,
      oldVerdict: "accepted",
      oldScore: 100,
      oldResultJson: null,
    });
    const recentLog = await submissionRejudgeLogRepo.create({
      submissionId: submission.id,
      rejudgedByUserId: null,
      rejudgeRunId: null,
      oldVerdict: "wrong_answer",
      oldScore: 0,
      oldResultJson: null,
    });
    const past = new Date(Date.now() - 100 * 24 * 60 * 60_000);
    await testPrisma.$executeRaw`UPDATE "SubmissionRejudgeLog" SET "createdAt" = ${past} WHERE "id" = ${oldLog.id}`;

    const result = await submissionDomain.sweepStaleSubmissions();

    expect(result.rejudgeLogsPruned).toBeGreaterThanOrEqual(1);
    const [oldRow, recentRow] = await Promise.all([
      testPrisma.submissionRejudgeLog.findUnique({ where: { id: oldLog.id } }),
      testPrisma.submissionRejudgeLog.findUnique({ where: { id: recentLog.id } }),
    ]);
    expect(oldRow).toBeNull();
    expect(recentRow).not.toBeNull();
  });
});

describe("submission pending timeout setting (env)", () => {
  const previous = process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES;
  afterEach(() => {
    if (previous === undefined) delete process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES;
    else process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES = previous;
  });

  it("falls back to the default when unset or invalid", () => {
    delete process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES;
    expect(submissionDomain.getSubmissionPendingTimeoutMinutes()).toBe(10);

    process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES = "garbage";
    expect(submissionDomain.getSubmissionPendingTimeoutMinutes()).toBe(10);

    process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES = "5";
    expect(submissionDomain.getSubmissionPendingTimeoutMinutes()).toBe(10);
  });

  it("reads valid in-range values from the environment", () => {
    process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES = "60";
    expect(submissionDomain.getSubmissionPendingTimeoutMinutes()).toBe(60);
  });
});
