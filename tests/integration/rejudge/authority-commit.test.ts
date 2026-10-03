import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submissionDomain } from "@nojv/application";
import { prismaAdapterClient as db } from "@nojv/db";
import * as snapshots from "../../../packages/application/src/submission/judge-snapshot";
import * as executions from "../../../packages/application/src/submission/judge-execution";
import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

beforeEach(() => vi.stubEnv("SANDBOX_IMAGE", `sandbox@sha256:${"a".repeat(64)}`));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function afterSnapshot(change: () => Promise<unknown>) {
  const prepare = snapshots.prepareJudgeSnapshot;
  vi.spyOn(snapshots, "prepareJudgeSnapshot").mockImplementationOnce(async (...args) => {
    const snapshot = await prepare(...args);
    await change();
    return snapshot;
  });
}

async function expectUnchanged(submissionId: string) {
  expect(await db.judgeExecution.count({ where: { submissionId } })).toBe(0);
  expect(await db.submissionRejudgeLog.count({ where: { submissionId } })).toBe(0);
  expect(await db.durableWork.count({ where: { kind: "submission.rejudge.dispatch" } })).toBe(
    0,
  );
  expect(await db.submission.findUnique({ where: { id: submissionId } })).toMatchObject({
    judgeGeneration: 0,
    activeJudgeRunId: null,
    status: "accepted",
    score: 100,
  });
}

describe("rejudge authority at commit", () => {
  it.each([
    ["assignment", "single"],
    ["assignment", "batch"],
    ["exam", "single"],
    ["exam", "batch"],
  ] as const)(
    "rejects revoked staff for %s %s after snapshot preparation",
    async (type, mode) => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const course = await createTestCourse();
      const membership = await db.courseMembership.create({
        data: { courseId: course.id, userId: teacher.id, role: "ta", status: "active" },
      });
      const problem = await createTestProblem();
      const activity =
        type === "exam"
          ? await createTestExam({ courseId: course.id, createdByUserId: course.ownerId })
          : await db.assessment.create({
              data: {
                courseId: course.id,
                createdByUserId: course.ownerId,
                title: "Rejudge assignment",
                summary: "Rejudge authorization test",
                status: "published",
                opensAt: new Date("2026-01-01"),
                closesAt: new Date("2027-01-01"),
              },
            });
      const context =
        type === "exam"
          ? { examId: activity.id }
          : { assessmentId: activity.id, courseId: course.id };
      const submission = await createTestSubmission({
        problemId: problem.id,
        status: "accepted",
        score: 100,
        ...context,
      });
      afterSnapshot(() =>
        db.courseMembership.update({
          where: { id: membership.id },
          data: { status: "removed" },
        }),
      );
      await expect(
        submissionDomain.dispatchRejudge(
          mode === "single"
            ? { mode, submissionId: submission.id, triggeredByUserId: teacher.id }
            : {
                mode,
                problemId: problem.id,
                triggeredByUserId: teacher.id,
                ...(type === "exam" ? { examId: activity.id } : { assessmentId: activity.id }),
              },
          { userId: teacher.id, platformRole: "teacher" },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expectUnchanged(submission.id);
    },
  );

  it("rejects ownership transfer without a judge-content generation change", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const other = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const submission = await createTestSubmission({ problemId: problem.id, score: 100 });
    afterSnapshot(() =>
      db.problem.update({ where: { id: problem.id }, data: { authorId: other.id } }),
    );
    await expect(
      submissionDomain.dispatchRejudge(
        { mode: "single", submissionId: submission.id, triggeredByUserId: teacher.id },
        { userId: teacher.id, platformRole: "teacher" },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expectUnchanged(submission.id);
  });

  it("rejects a changed contest organizer before committing a batch", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const other = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const contest = await createTestContest({ createdByUserId: teacher.id });
    const submission = await createTestSubmission({
      problemId: problem.id,
      contestId: contest.id,
      score: 100,
    });
    afterSnapshot(() =>
      db.contest.update({ where: { id: contest.id }, data: { createdByUserId: other.id } }),
    );
    await expect(
      submissionDomain.dispatchRejudge(
        {
          mode: "batch",
          problemId: problem.id,
          contestId: contest.id,
          triggeredByUserId: teacher.id,
        },
        { userId: teacher.id, platformRole: "teacher" },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expectUnchanged(submission.id);
  });

  it("holds staff authority until the authorized rejudge commits", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse();
    const membership = await db.courseMembership.create({
      data: { courseId: course.id, userId: teacher.id, role: "ta", status: "active" },
    });
    const exam = await createTestExam({ courseId: course.id, createdByUserId: course.ownerId });
    const problem = await createTestProblem();
    const submission = await createTestSubmission({ problemId: problem.id, examId: exam.id });
    let ready!: (pid: number) => void;
    let failed!: (error: unknown) => void;
    const held = new Promise<number>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = executions.createJudgeExecution;
    vi.spyOn(executions, "createJudgeExecution").mockImplementationOnce(async (tx, input) => {
      const backend = (
        await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      ).at(0);
      if (!backend) throw new Error("Missing PostgreSQL backend pid.");
      ready(backend.pid);
      await released;
      return create(tx, input);
    });
    const operation = submissionDomain.dispatchRejudge(
      { mode: "single", submissionId: submission.id, triggeredByUserId: teacher.id },
      { userId: teacher.id, platformRole: "teacher" },
    );
    void operation.catch(failed);
    let revoked: Promise<unknown> | undefined;
    try {
      const pid = await held;
      revoked = db.courseMembership
        .update({ where: { id: membership.id }, data: { status: "removed" } })
        .then((value) => value);
      await expect
        .poll(
          async () => {
            const state = (
              await db.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE ${pid} = ANY(pg_blocking_pids(pid))
              AND query LIKE '%UPDATE%CourseMembership%') AS blocked
        `
            ).at(0);
            return state?.blocked ?? false;
          },
          { timeout: 2000 },
        )
        .toBe(true);
    } finally {
      release();
      await Promise.allSettled([operation, ...(revoked ? [revoked] : [])]);
    }
    await expect(operation).resolves.toHaveProperty("workflowId");
    await revoked;
    expect(await db.judgeExecution.count({ where: { submissionId: submission.id } })).toBe(1);
    expect(
      await db.courseMembership.findUnique({ where: { id: membership.id } }),
    ).toMatchObject({ status: "removed" });
  });
});
