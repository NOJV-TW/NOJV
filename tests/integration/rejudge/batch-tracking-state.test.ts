import { randomUUID } from "node:crypto";
import type { RejudgeInput } from "@nojv/core";
import { durableWorkRepo } from "@nojv/db";
import { describe, expect, it } from "vitest";
import { submissionDomain } from "@nojv/application";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function enqueueLegacyRejudge(input: RejudgeInput) {
  const workflowId = `rejudge-${randomUUID()}`;
  await durableWorkRepo.enqueue({
    kind: "submission.rejudge.dispatch",
    dedupeKey: workflowId,
    payload: JSON.parse(JSON.stringify({ input, workflowId })),
  });
  return { workflowId };
}

async function fixture() {
  const user = await createTestUser();
  const problem = await createTestProblem();
  const course = await createTestCourse();
  const exam = await createTestExam({ courseId: course.id });
  const otherExam = await createTestExam({ courseId: course.id });
  const actor = {
    userId: user.id,
    username: user.username!,
    email: user.email,
    displayName: user.name,
    platformRole: "student" as const,
  };
  const createdAt = new Date(Date.now() - 60_000);
  const target = await createTestSubmission({
    userId: user.id,
    problemId: problem.id,
    examId: exam.id,
    createdAt,
    score: 100,
  });
  return { user, problem, exam, otherExam, actor, target, createdAt };
}

describe("legacy batch rejudge status overlay against the real database", () => {
  it("hides only eligible targets across discovery, batch reads, and numbered history while dispatch waits", async () => {
    const f = await fixture();
    const otherUser = await createTestUser();
    const otherProblem = await createTestProblem();
    const excluded = await Promise.all([
      createTestSubmission({
        userId: f.user.id,
        problemId: f.problem.id,
        examId: f.otherExam.id,
        createdAt: f.createdAt,
      }),
      createTestSubmission({
        userId: otherUser.id,
        problemId: f.problem.id,
        examId: f.exam.id,
        createdAt: f.createdAt,
      }),
      createTestSubmission({
        userId: f.user.id,
        problemId: otherProblem.id,
        examId: f.exam.id,
        createdAt: f.createdAt,
      }),
      createTestSubmission({
        userId: f.user.id,
        problemId: f.problem.id,
        examId: f.exam.id,
        createdAt: new Date(f.createdAt.getTime() - 10_000),
      }),
      createTestSubmission({
        userId: f.user.id,
        problemId: f.problem.id,
        examId: f.exam.id,
        createdAt: new Date(f.createdAt.getTime() + 10_000),
      }),
      createTestSubmission({
        userId: f.user.id,
        problemId: f.problem.id,
        examId: f.exam.id,
        createdAt: f.createdAt,
        sampleOnly: true,
      }),
      createTestSubmission({
        userId: f.user.id,
        problemId: f.problem.id,
        createdAt: f.createdAt,
        isReferenceSolution: true,
      }),
    ]);
    await enqueueLegacyRejudge({
      mode: "batch",
      problemId: f.problem.id,
      examId: f.exam.id,
      userIds: [f.user.id],
      since: f.createdAt.toISOString(),
      until: f.createdAt.toISOString(),
      triggeredByUserId: f.user.id,
    });
    const pending = await submissionDomain.listPendingSubmissionOperations(f.actor);
    expect(pending.items.map((item) => item.submissionId)).toEqual([f.target.id]);
    expect(pending.items[0]).toMatchObject({ status: "queued", result: null });
    const states = await submissionDomain.listSubmissionOperations(f.actor, [
      f.target.id,
      ...excluded.map((row) => row.id),
    ]);
    expect(
      states.items.filter((item) => item.status === "queued").map((item) => item.submissionId),
    ).toEqual([f.target.id]);
    const history = await submissionDomain.listUserSubmissions({
      actor: f.actor,
      limit: 50,
      filters: { status: "queued" },
    });
    expect(history.items.map((item) => item.id)).toEqual([f.target.id]);
    expect(history.items[0]?.score).toBeNull();
  });

  it.each(["failed", "cancelled"] as const)(
    "releases unstarted targets after %s without changing stored scoring",
    async (status) => {
      const f = await fixture();
      const { workflowId } = await enqueueLegacyRejudge({
        mode: "batch",
        problemId: f.problem.id,
        examId: f.exam.id,
        triggeredByUserId: f.user.id,
      });
      await testPrisma.durableWork.update({
        where: {
          kind_dedupeKey: { kind: "submission.rejudge.dispatch", dedupeKey: workflowId },
        },
        data: {
          status: "succeeded",
          attempt: 1,
          completedAt: new Date(),
          result: {
            status,
            completed: 0,
            total: 1,
            targets: [{ submissionId: f.target.id, judgeGeneration: f.target.judgeGeneration }],
          },
        },
      });
      expect(await submissionDomain.getSubmissionOperation(f.actor, f.target.id)).toMatchObject(
        { status: "accepted", result: { score: 100 } },
      );
      expect(
        await testPrisma.submission.findUniqueOrThrow({ where: { id: f.target.id } }),
      ).toMatchObject({ status: "accepted", score: 100 });
    },
  );
});
