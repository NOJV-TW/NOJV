import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { terminateSubmissionJudge, describeSubmissionJudge, dispatchSubmissionJudge } =
  vi.hoisted(() => ({
    terminateSubmissionJudge: vi.fn(),
    describeSubmissionJudge: vi.fn(),
    dispatchSubmissionJudge: vi.fn(),
  }));

import { durableWorkRepo, submissionRejudgeLogRepo, submissionRepo } from "@nojv/db";
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
  dispatchSubmissionJudge.mockReset();
  dispatchSubmissionJudge.mockResolvedValue(undefined);
  describeSubmissionJudge.mockResolvedValue(null);
  configureDomainOrchestration({
    cancelAssignmentDueSoon: vi.fn(async () => {}),
    cancelContestLifecycle: vi.fn(async () => {}),
    cancelExamAutoClose: vi.fn(async () => {}),
    cancelRejudge: vi.fn(async () => {}),
    describeSubmissionJudge,
    dispatchPlagiarismCheck: vi.fn(async () => {}),
    dispatchRegistryGarbageCollect: vi.fn(async () => ({
      workflowId: "registry-gc",
      alreadyRunning: false,
    })),
    dispatchRejudge: vi.fn(async () => ({ workflowId: "rejudge-test" })),
    dispatchSubmissionJudge,
    dispatchJudgeExecution: vi.fn(async () => {}),
    dispatchJudgeCleanup: vi.fn(async () => {}),
    ensureAssignmentDueSoon: vi.fn(async () => {}),
    ensureContestLifecycle: vi.fn(async () => {}),
    ensureExamAutoClose: vi.fn(async () => {}),
    probeTemporal: vi.fn(async () => {}),
    queryRejudgeProgress: vi.fn(async () => ({
      status: "running" as const,
      completed: 0,
      total: 0,
    })),
    replaceAssignmentDueSoon: vi.fn(async () => {}),
    replaceContestLifecycle: vi.fn(async () => {}),
    replaceExamAutoClose: vi.fn(async () => {}),
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
  it.each(["pending", "leased"] as const)(
    "blocks late legacy dispatch after sweeping a %s initial outbox row",
    async (dispatchState) => {
      const stale = await createTestSubmission({ status: "queued" });
      await backdateUpdatedAt(stale.id, 60);
      const kind = submissionDomain.SUBMISSION_JUDGE_DISPATCH_WORK_KIND;
      await durableWorkRepo.enqueue({
        kind,
        dedupeKey: stale.id,
        maxAttempts: 20,
        payload: {
          submissionId: stale.id,
          draft: { problemId: stale.problemId, language: stale.language, sampleOnly: false },
        },
      });
      if (dispatchState === "leased") {
        const claimed = await durableWorkRepo.claimBatch({
          kinds: [kind],
          owner: "delayed-dispatch-worker",
          limit: 1,
          now: new Date(),
          leaseDurationMs: 60_000,
        });
        expect(claimed).toHaveLength(1);
        expect(claimed[0]).toMatchObject({ status: "leased", dedupeKey: stale.id });
      }
      const delayed = await testPrisma.durableWork.findFirstOrThrow({
        where: { kind, dedupeKey: stale.id },
      });
      expect(delayed.status).toBe(dispatchState);

      const result = await submissionDomain.sweepStaleSubmissions();
      expect(result.killed).toBe(1);
      expect(result.failed).toBe(0);
      expect(terminateSubmissionJudge).not.toHaveBeenCalled();
      const blocked = await submissionRepo.findById(stale.id);
      expect(blocked).toMatchObject({
        status: "system_error",
        activeJudgeRunId: null,
        verdictSummary: {
          systemErrorTruncated: expect.stringContaining(
            "Original judge version is unavailable",
          ),
        },
      });
      await expect(
        testPrisma.durableWork.findUniqueOrThrow({ where: { id: delayed.id } }),
      ).resolves.toMatchObject({
        status: "cancelled",
        leaseOwner: null,
        leaseExpiresAt: null,
        attempt: dispatchState === "leased" ? 1 : 0,
      });

      await submissionDomain.executeSubmissionJudgeDispatch(delayed.payload);
      expect(dispatchSubmissionJudge).not.toHaveBeenCalled();
      await expect(
        submissionDomain.startSubmissionJudgeRun(stale.id, "late-legacy-run"),
      ).rejects.toThrow("cannot start a legacy judge run");
      await expect(submissionRepo.findById(stale.id)).resolves.toEqual(blocked);
      expect(await testPrisma.judgeExecution.count({ where: { submissionId: stale.id } })).toBe(
        0,
      );
      await expect(
        durableWorkRepo.claimBatch({
          kinds: [kind],
          owner: "another-dispatch-worker",
          limit: 1,
          now: new Date(),
          leaseDurationMs: 60_000,
        }),
      ).resolves.toEqual([]);
    },
  );

  it("blocks stale legacy submissions and leaves fresh or terminal ones alone", async () => {
    const stale = await createTestSubmission({ status: "queued" });
    const fresh = await createTestSubmission({ status: "running" });
    const terminal = await createTestSubmission({ status: "accepted" });
    await backdateUpdatedAt(stale.id, 60);
    await backdateUpdatedAt(terminal.id, 60);

    const result = await submissionDomain.sweepStaleSubmissions();

    expect(terminateSubmissionJudge).not.toHaveBeenCalled();
    expect(result.killed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const [staleRow, freshRow, terminalRow] = await Promise.all([
      submissionRepo.findById(stale.id),
      submissionRepo.findById(fresh.id),
      submissionRepo.findById(terminal.id),
    ]);
    expect(staleRow?.status).toBe("system_error");
    expect(staleRow?.verdictSummary).toMatchObject({
      systemErrorTruncated: expect.stringContaining("Original judge version is unavailable"),
    });
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

  it.each([
    { activeOwner: null, logOwner: "old-log-child", expectedOwner: "old-log-child" },
    {
      activeOwner: "active-child",
      logOwner: "superseded-log-child",
      expectedOwner: "active-child",
    },
  ])(
    "observes the actual healthy owner $expectedOwner before considering legacy recovery",
    async ({ activeOwner, logOwner, expectedOwner }) => {
      describeSubmissionJudge.mockResolvedValue({ status: "RUNNING", running: true });
      const stale = await createTestSubmission({ status: "running" });
      if (activeOwner)
        await testPrisma.submission.update({
          where: { id: stale.id },
          data: { activeJudgeRunId: activeOwner },
        });
      const log = await submissionRejudgeLogRepo.create({
        submissionId: stale.id,
        rejudgedByUserId: null,
        rejudgeRunId: logOwner,
        oldVerdict: "accepted",
        oldScore: 100,
        oldResultJson: null,
      });
      await testPrisma.submissionRejudgeLog.update({
        where: { id: log.id },
        data: { createdAt: new Date(Date.now() - 60 * 60_000) },
      });
      await backdateUpdatedAt(stale.id, 60);

      await submissionDomain.sweepStaleSubmissions();

      expect(describeSubmissionJudge).toHaveBeenCalledExactlyOnceWith(stale.id, expectedOwner);
      expect(terminateSubmissionJudge).not.toHaveBeenCalled();
      expect(await submissionRepo.findById(stale.id)).toMatchObject({
        status: "running",
        activeJudgeRunId: activeOwner,
      });
    },
  );

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

  it("skips marking when workflow observation fails", async () => {
    const failure = new Error("temporal unreachable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    describeSubmissionJudge.mockRejectedValueOnce(failure);
    const stale = await createTestSubmission({ status: "compiling" });
    await backdateUpdatedAt(stale.id, 60);

    const result = await submissionDomain.sweepStaleSubmissions();

    expect(result.failed).toBeGreaterThanOrEqual(1);
    const row = await submissionRepo.findById(stale.id);
    expect(row?.status).toBe("compiling");
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to reconcile stale submission",
      { submissionId: stale.id },
      failure,
    );
    errorLog.mockRestore();
  });

  it("does not overwrite a judge run that starts during stale recovery", async () => {
    const stale = await createTestSubmission({ status: "queued" });
    await backdateUpdatedAt(stale.id, 60);
    describeSubmissionJudge.mockImplementationOnce(async () => {
      await testPrisma.submission.update({
        where: { id: stale.id },
        data: { status: "running", activeJudgeRunId: "new-run" },
      });
      return null;
    });

    const result = await submissionDomain.sweepStaleSubmissions();

    expect(result.killed).toBe(0);
    await expect(submissionRepo.findById(stale.id)).resolves.toMatchObject({
      activeJudgeRunId: "new-run",
      status: "running",
    });
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

  it("reaps a stale submission whose open rejudge log is old (dead rejudge, e.g. worker OOM)", async () => {
    const stale = await createTestSubmission({ status: "running" });
    await backdateUpdatedAt(stale.id, 60);
    const deadLog = await submissionRejudgeLogRepo.create({
      submissionId: stale.id,
      rejudgedByUserId: null,
      rejudgeRunId: null,
      oldVerdict: "accepted",
      oldScore: 100,
      oldResultJson: null,
    });
    const past = new Date(Date.now() - 60 * 60_000);
    await testPrisma.$executeRaw`UPDATE "SubmissionRejudgeLog" SET "createdAt" = ${past} WHERE "id" = ${deadLog.id}`;

    await submissionDomain.sweepStaleSubmissions();

    expect(terminateSubmissionJudge).not.toHaveBeenCalled();
    const row = await submissionRepo.findById(stale.id);
    expect(row?.status).toBe("system_error");
  });

  it("skips a stale submission whose open rejudge log is recent (rejudge in-flight)", async () => {
    const stale = await createTestSubmission({ status: "running" });
    await backdateUpdatedAt(stale.id, 60);
    await submissionRejudgeLogRepo.create({
      submissionId: stale.id,
      rejudgedByUserId: null,
      rejudgeRunId: null,
      oldVerdict: "accepted",
      oldScore: 100,
      oldResultJson: null,
    });

    await submissionDomain.sweepStaleSubmissions();

    expect(terminateSubmissionJudge).not.toHaveBeenCalledWith(
      stale.id,
      expect.any(String),
      undefined,
    );
    const row = await submissionRepo.findById(stale.id);
    expect(row?.status).toBe("running");
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
