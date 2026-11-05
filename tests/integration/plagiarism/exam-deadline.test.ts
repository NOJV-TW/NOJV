import { expect, it, vi } from "vitest";
import { plagiarismDomain } from "@nojv/application";
import { examAutoCloseInput } from "../../../packages/application/src/shared/lifecycle-input";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../../../packages/application/src/plagiarism/dispatch", () => ({
  dispatchPlagiarismCheck: dispatch,
}));

it("waits for in-window judging, retries dispatch with one receipt and enforces the same cutoff on reruns and source views", async () => {
  const course = await createTestCourse();
  const problem = await createTestProblem();
  const student = await createTestUser();
  const endsAt = new Date(Date.now() - 60_000);
  const startsAt = new Date(endsAt.getTime() - 60_000);
  const exam = await createTestExam({ courseId: course.id, startsAt, endsAt });
  const input = examAutoCloseInput(exam);
  const submission = {
    examId: exam.id,
    userId: student.id,
    problemId: problem.id,
    createdAt: new Date(endsAt.getTime() - 1),
    score: 50,
  };
  const eligible = await createTestSubmission(submission);
  await createTestSubmission({ ...submission, createdAt: endsAt, score: 100 });
  await createTestSubmission({
    ...submission,
    createdAt: new Date(startsAt.getTime() - 1),
    score: 100,
  });
  await createTestSubmission({ ...submission, sampleOnly: true, score: 100 });
  const judging = await createTestSubmission({ ...submission, status: "running" });
  expect(await plagiarismDomain.triggerClosedExamReport(input)).toBe("wait");
  expect(dispatch).not.toHaveBeenCalled();
  await testPrisma.submission.update({
    where: { id: judging.id },
    data: { status: "wrong_answer" },
  });

  expect(
    await plagiarismDomain.triggerClosedExamReport({
      ...input,
      scheduleRevision: input.scheduleRevision + 1,
    }),
  ).toBe("done");
  expect(dispatch).not.toHaveBeenCalled();
  dispatch.mockRejectedValueOnce(new Error("unavailable"));
  await expect(plagiarismDomain.triggerClosedExamReport(input)).rejects.toThrow("unavailable");
  expect(await plagiarismDomain.triggerClosedExamReport(input)).toBe("done");
  expect(dispatch).toHaveBeenLastCalledWith({
    targetType: "exam",
    targetId: exam.id,
    triggeredById: null,
  });
  const target = { type: "exam", id: exam.id } as const;
  expect(await plagiarismDomain.listSubmissionsForCheck(target)).toEqual([
    expect.objectContaining({ id: eligible.id }),
  ]);
  expect(
    await plagiarismDomain.getPlagiarismSourceCode(target, student.id, problem.id),
  ).toMatchObject({ submissionId: eligible.id });
  await plagiarismDomain.saveResults(target, { pairs: [] }, null);
  expect(await plagiarismDomain.triggerClosedExamReport(input)).toBe("done");
  expect(dispatch).toHaveBeenCalledTimes(2);
  expect(await testPrisma.plagiarismTriggerLog.count({ where: { contextId: exam.id } })).toBe(
    1,
  );
  const previous = await plagiarismDomain.currentExamReportRun(exam.id);
  await plagiarismDomain.createPlagiarismReport(target, student.id);
  await plagiarismDomain.saveResults(previous, { pairs: [] }, null);
  await plagiarismDomain.markReportFailed(previous);
  expect((await plagiarismDomain.findPlagiarismReport(target))?.status).toBe("pending");
});

it("does not trigger a report on an archived course", async () => {
  dispatch.mockClear();
  const course = await createTestCourse({ archived: true });
  const exam = await createTestExam({
    courseId: course.id,
    endsAt: new Date(Date.now() - 60_000),
    startsAt: new Date(Date.now() - 120_000),
  });
  expect(await plagiarismDomain.triggerClosedExamReport(examAutoCloseInput(exam))).toBe("done");
  expect(dispatch).not.toHaveBeenCalled();
});
