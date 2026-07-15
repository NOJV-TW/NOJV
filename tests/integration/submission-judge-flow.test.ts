import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contestDomain, submissionDomain } from "@nojv/application";
import { submissionRepo } from "@nojv/db";
import type { SubmissionResult } from "@nojv/core";

import {
  createTestContest,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../fixtures/factories";

async function attachProblemToContest(
  contestId: string,
  problemId: string,
  ordinal = 1,
  points = 100,
) {
  await testPrisma.contestProblem.create({
    data: { contestId, problemId, ordinal, points },
  });
}

async function startContestParticipation(contestId: string, userId: string) {
  return testPrisma.participation.create({
    data: {
      type: "contest",
      contestId,
      userId,
      status: "active",
      startedAt: new Date(),
    },
  });
}

async function createQueuedContestSubmission(opts: {
  userId: string;
  problemId: string;
  contestId: string;
  language?: string;
}) {
  return createTestSubmission({
    userId: opts.userId,
    problemId: opts.problemId,
    contestId: opts.contestId,
    language: opts.language ?? "python",
    status: "queued",
    sampleOnly: false,
  });
}

async function completeJudge(
  submissionId: string,
  result: SubmissionResult,
  judgeRunId = `judge-${submissionId}`,
) {
  await submissionDomain.startSubmissionJudgeRun(submissionId, judgeRunId);
  return submissionDomain.completeJudge(submissionId, judgeRunId, result);
}

describe("submit → judge → score-persist end-to-end (real DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("AC submission persists participation.score = 100", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const contest = await createTestContest({
      createdByUserId: teacher.id,
      visibility: "published",
      scoringMode: "point_sum",
    });
    await attachProblemToContest(contest.id, problem.id);
    const participation = await startContestParticipation(contest.id, student.id);

    const submission = await createQueuedContestSubmission({
      userId: student.id,
      problemId: problem.id,
      contestId: contest.id,
    });
    expect(submission.status).toBe("queued");

    const completed = await completeJudge(submission.id, {
      accepted: true,
      caseResults: [],
      feedback: "All testcases passed",
      runtimeMs: 42,
      score: 100,
      verdict: "accepted",
    });

    expect(completed.status).toBe("accepted");
    expect(completed.score).toBe(100);
    expect(completed.contestId).toBe(contest.id);

    const reread = await submissionRepo.findById(submission.id);
    expect(reread?.status).toBe("accepted");
    expect(reread?.score).toBe(100);

    await contestDomain.updateContestScores(contest.id, student.id);

    const updatedParticipation = await testPrisma.participation.findUnique({
      where: { id: participation.id },
    });
    expect(updatedParticipation?.score).toBe(100);
  });

  it("WA submission keeps participation.score at 0", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const contest = await createTestContest({
      createdByUserId: teacher.id,
      visibility: "published",
      scoringMode: "point_sum",
    });
    await attachProblemToContest(contest.id, problem.id);
    const participation = await startContestParticipation(contest.id, student.id);

    const submission = await createQueuedContestSubmission({
      userId: student.id,
      problemId: problem.id,
      contestId: contest.id,
    });

    await completeJudge(submission.id, {
      accepted: false,
      caseResults: [],
      feedback: "Failed on testcase 1",
      runtimeMs: 12,
      score: 0,
      verdict: "wrong_answer",
    });

    await contestDomain.updateContestScores(contest.id, student.id);

    const updated = await testPrisma.participation.findUnique({
      where: { id: participation.id },
    });
    expect(updated?.score).toBe(0);
  });

  it("two participants get distinct persisted scores after judging completes", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const studentA = await createTestUser();
    const studentB = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const contest = await createTestContest({
      createdByUserId: teacher.id,
      visibility: "published",
      scoringMode: "point_sum",
    });
    await attachProblemToContest(contest.id, problem.id);
    const partA = await startContestParticipation(contest.id, studentA.id);
    const partB = await startContestParticipation(contest.id, studentB.id);

    const subA = await createQueuedContestSubmission({
      userId: studentA.id,
      problemId: problem.id,
      contestId: contest.id,
    });
    const subB = await createQueuedContestSubmission({
      userId: studentB.id,
      problemId: problem.id,
      contestId: contest.id,
    });

    await completeJudge(subA.id, {
      accepted: true,
      caseResults: [],
      feedback: "ok",
      runtimeMs: 10,
      score: 100,
      verdict: "accepted",
    });
    await completeJudge(subB.id, {
      accepted: false,
      caseResults: [],
      feedback: "wa",
      runtimeMs: 10,
      score: 30,
      verdict: "wrong_answer",
    });

    await contestDomain.updateContestScores(contest.id, studentA.id);
    await contestDomain.updateContestScores(contest.id, studentB.id);

    const [rowA, rowB] = await Promise.all([
      testPrisma.participation.findUnique({ where: { id: partA.id } }),
      testPrisma.participation.findUnique({ where: { id: partB.id } }),
    ]);
    expect(rowA?.score).toBe(100);
    expect(rowB?.score).toBe(30);
  });

  it("rejudging a submission upward replays the new score onto the participation row", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const contest = await createTestContest({
      createdByUserId: teacher.id,
      visibility: "published",
      scoringMode: "point_sum",
    });
    await attachProblemToContest(contest.id, problem.id);
    const participation = await startContestParticipation(contest.id, student.id);

    const submission = await createQueuedContestSubmission({
      userId: student.id,
      problemId: problem.id,
      contestId: contest.id,
    });

    await completeJudge(submission.id, {
      accepted: false,
      caseResults: [],
      feedback: "wa",
      runtimeMs: 10,
      score: 0,
      verdict: "wrong_answer",
    });
    await contestDomain.updateContestScores(contest.id, student.id);
    expect(
      (await testPrisma.participation.findUnique({ where: { id: participation.id } }))?.score,
    ).toBe(0);

    const rejudgeRunId = `rejudge-${submission.id}`;
    await submissionDomain.snapshotForRejudge(submission.id, teacher.id, rejudgeRunId);
    await completeJudge(
      submission.id,
      {
        accepted: true,
        caseResults: [],
        feedback: "ac",
        runtimeMs: 10,
        score: 100,
        verdict: "accepted",
      },
      rejudgeRunId,
    );
    await contestDomain.updateContestScores(contest.id, student.id);

    const updated = await testPrisma.participation.findUnique({
      where: { id: participation.id },
    });
    expect(updated?.score).toBe(100);
  });
});
