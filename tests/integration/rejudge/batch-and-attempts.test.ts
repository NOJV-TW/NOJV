import { describe, expect, it } from "vitest";

import { submissionRepo } from "@nojv/db";
import { submissionDomain } from "@nojv/application";

import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function createTestAssignment(opts: {
  courseId: string;
  createdByUserId: string;
  maxAttemptsPerDay?: number;
  attemptResetMinuteOfDay?: number;
}) {
  return testPrisma.assessment.create({
    data: {
      courseId: opts.courseId,
      createdByUserId: opts.createdByUserId,
      title: "Integration HW",
      summary: "homework summary text",
      status: "published",
      opensAt: new Date("2026-01-01T00:00:00.000Z"),
      closesAt: new Date("2027-01-01T00:00:00.000Z"),
      ...(opts.maxAttemptsPerDay != null ? { maxAttemptsPerDay: opts.maxAttemptsPerDay } : {}),
      ...(opts.attemptResetMinuteOfDay != null
        ? { attemptResetMinuteOfDay: opts.attemptResetMinuteOfDay }
        : {}),
    },
  });
}

describe("rejudge — attempt-quota invariant (real DB)", () => {
  it("re-judging an existing submission does not consume the student's attempt quota", async () => {
    const student = await createTestUser();
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({ authorId: teacher.id });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assignment = await createTestAssignment({
      courseId: course.id,
      createdByUserId: teacher.id,
      maxAttemptsPerDay: 3,
      attemptResetMinuteOfDay: 0, // Taipei midnight → stable window for "now"
    });

    const submission = await createTestSubmission({
      userId: student.id,
      problemId: problem.id,
      assessmentId: assignment.id,
      status: "wrong_answer",
      score: 30,
    });

    const windowStart = submissionDomain.attemptWindowStart(0, new Date());
    const before = await submissionRepo.countForUserAssessmentProblemSince(
      student.id,
      assignment.id,
      problem.id,
      windowStart,
    );
    expect(before).toBe(1);

    const snap = await submissionDomain.snapshotForRejudge(
      submission.id,
      teacher.id,
      `run-${submission.id}`,
    );
    expect(snap).not.toBeNull();
    await submissionRepo.complete(submission.id, { status: "accepted", score: 100 });
    await submissionDomain.finalizeRejudgeLog(submission.id, teacher.id, snap!.logId);

    const after = await submissionRepo.countForUserAssessmentProblemSince(
      student.id,
      assignment.id,
      problem.id,
      windowStart,
    );
    expect(after).toBe(1);
  });
});

describe("listRejudgeLogsPaged (real DB)", () => {
  async function makeRejudgeLog(opts: {
    problemId: string;
    studentId: string;
    teacherId: string;
  }) {
    const sub = await createTestSubmission({
      userId: opts.studentId,
      problemId: opts.problemId,
      status: "wrong_answer",
      score: 0,
    });
    const snap = await submissionDomain.snapshotForRejudge(
      sub.id,
      opts.teacherId,
      `run-${sub.id}`,
    );
    await submissionRepo.complete(sub.id, { status: "accepted", score: 100 });
    await submissionDomain.finalizeRejudgeLog(sub.id, opts.teacherId, snap!.logId);
    return sub;
  }

  it("paginates by cursor and filters by problemId", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const problemA = await createTestProblem({ authorId: teacher.id });
    const problemB = await createTestProblem({ authorId: teacher.id });

    await makeRejudgeLog({
      problemId: problemA.id,
      studentId: student.id,
      teacherId: teacher.id,
    });
    await makeRejudgeLog({
      problemId: problemA.id,
      studentId: student.id,
      teacherId: teacher.id,
    });
    await makeRejudgeLog({
      problemId: problemB.id,
      studentId: student.id,
      teacherId: teacher.id,
    });

    const page1 = await submissionDomain.listRejudgeLogsPaged({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await submissionDomain.listRejudgeLogsPaged({
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const filtered = await submissionDomain.listRejudgeLogsPaged({
      limit: 10,
      problemId: problemB.id,
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]!.submission.problemId).toBe(problemB.id);
  });
});
