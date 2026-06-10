import { beforeEach, describe, expect, it, vi } from "vitest";

const { terminateSubmissionJudge } = vi.hoisted(() => ({
  terminateSubmissionJudge: vi.fn(),
}));

vi.mock("@nojv/temporal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/temporal")>();
  return { ...actual, terminateSubmissionJudge };
});

import { SUBMISSION_PENDING_TIMEOUT_SETTING_KEY } from "@nojv/core";
import { platformSettingRepo, submissionRepo } from "@nojv/db";
import { submissionDomain, ValidationError } from "@nojv/domain";

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

  it("uses the configured timeout threshold", async () => {
    await submissionDomain.setSubmissionPendingTimeoutMinutes(10);

    const beyondCustom = await createTestSubmission({ status: "queued" });
    await backdateUpdatedAt(beyondCustom.id, 15);

    await submissionDomain.sweepStaleSubmissions();

    const row = await submissionRepo.findById(beyondCustom.id);
    expect(row?.status).toBe("system_error");
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
});

describe("submission pending timeout setting (real DB)", () => {
  it("falls back to the default when unset or invalid", async () => {
    expect(await submissionDomain.getSubmissionPendingTimeoutMinutes()).toBe(30);

    await platformSettingRepo.set(SUBMISSION_PENDING_TIMEOUT_SETTING_KEY, "garbage");
    expect(await submissionDomain.getSubmissionPendingTimeoutMinutes()).toBe(30);
  });

  it("persists valid values and rejects out-of-range ones", async () => {
    await submissionDomain.setSubmissionPendingTimeoutMinutes(60);
    expect(await submissionDomain.getSubmissionPendingTimeoutMinutes()).toBe(60);

    await expect(submissionDomain.setSubmissionPendingTimeoutMinutes(5)).rejects.toThrow(
      ValidationError,
    );
    await expect(submissionDomain.setSubmissionPendingTimeoutMinutes(2000)).rejects.toThrow(
      ValidationError,
    );
  });
});
