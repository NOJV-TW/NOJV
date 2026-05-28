// End-to-end coverage of the core submit → judge → scoreboard flow.
//
// We DO NOT spin up a Temporal worker or a sandbox container here.
// What we want to verify is the _domain contract_ that the judge worker
// relies on: a queued contest submission, when "completed" with a final
// verdict + score and pushed through `updateContestScores`, must land
// on the Redis scoreboard with the right score.
//
// Mocking the scoreboard side-effect (rather than using real Redis)
// keeps the test fast and self-contained. The Redis scoreboard module
// has its own dedicated integration coverage in
// `tests/integration/redis/scoreboard.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateScoreboardMock, freezeScoreboardMock, unfreezeScoreboardMock } = vi.hoisted(
  () => ({
    updateScoreboardMock: vi.fn(),
    freezeScoreboardMock: vi.fn(),
    unfreezeScoreboardMock: vi.fn(),
  }),
);

vi.mock("@nojv/redis", async (importOriginal) => {
  const original = await importOriginal<typeof import("@nojv/redis")>();
  return {
    ...original,
    scoreboard: {
      ...original.scoreboard,
      updateScoreboard: updateScoreboardMock,
      freezeScoreboard: freezeScoreboardMock,
      unfreezeScoreboard: unfreezeScoreboardMock,
    },
  };
});

import { contestDomain, submissionDomain } from "@nojv/domain";
import { submissionRepo } from "@nojv/db";

import {
  createTestContest,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../fixtures/factories";

// ─────────────────────────────────────────────────────────────────────────────

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
  return testPrisma.contestParticipation.create({
    data: {
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
  contestParticipationId: string;
  language?: string;
}) {
  const id = `sub_${Math.random().toString(36).slice(2, 10)}`;
  return testPrisma.submission.create({
    data: {
      id,
      userId: opts.userId,
      problemId: opts.problemId,
      contestId: opts.contestId,
      contestParticipationId: opts.contestParticipationId,
      language: opts.language ?? "python",
      // Source bytes live in object storage now; the row only carries the prefix.
      // This factory is for scoreboard tests that don't read source back, so we
      // skip the put-to-storage round trip entirely.
      sourceStoragePrefix: `submissions/${id}/sources/`,
      status: "queued",
      sampleOnly: false,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("submit → judge → scoreboard end-to-end (real DB, mocked scoreboard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("AC submission updates participation.score and pushes the score to the scoreboard", async () => {
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

    // Step 1: queued submission lands on disk (the domain createQueuedSubmissionRecord
    // path is unit-tested separately; we shortcut here so we can drive the
    // judge → scoreboard side without rebuilding all the auth plumbing).
    const submission = await createQueuedContestSubmission({
      userId: student.id,
      problemId: problem.id,
      contestId: contest.id,
      contestParticipationId: participation.id,
    });
    expect(submission.status).toBe("queued");

    // Step 2: judge completes the submission with verdict + score. This is
    // the same write the judge worker performs via `submissionDomain.completeJudge`.
    const completed = await submissionDomain.completeJudge(submission.id, {
      accepted: true,
      caseResults: [],
      feedback: "All testcases passed",
      runtimeMs: 42,
      score: 100,
      verdict: "accepted",
    });

    expect(completed.status).toBe("accepted");
    expect(completed.score).toBe(100);
    expect(completed.contestParticipationId).toBe(participation.id);

    const reread = await submissionRepo.findById(submission.id);
    expect(reread?.status).toBe("accepted");
    expect(reread?.score).toBe(100);

    // Step 3: scoring rebuild (worker calls this after each judge).
    await contestDomain.updateContestScores(participation.id);

    const updatedParticipation = await testPrisma.contestParticipation.findUnique({
      where: { id: participation.id },
    });
    expect(updatedParticipation?.score).toBe(100);

    // Scoreboard write: must reach Redis with (contestId, participationId, score).
    expect(updateScoreboardMock).toHaveBeenCalledTimes(1);
    expect(updateScoreboardMock).toHaveBeenCalledWith(
      contest.id,
      participation.id,
      100,
      "ioi",
      expect.any(Number),
    );
  });

  it("WA submission keeps participation.score at 0 and writes 0 to the scoreboard", async () => {
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
      contestParticipationId: participation.id,
    });

    await submissionDomain.completeJudge(submission.id, {
      accepted: false,
      caseResults: [],
      feedback: "Failed on testcase 1",
      runtimeMs: 12,
      score: 0,
      verdict: "wrong_answer",
    });

    await contestDomain.updateContestScores(participation.id);

    const updated = await testPrisma.contestParticipation.findUnique({
      where: { id: participation.id },
    });
    expect(updated?.score).toBe(0);
    expect(updateScoreboardMock).toHaveBeenCalledWith(
      contest.id,
      participation.id,
      0,
      "ioi",
      expect.any(Number),
    );
  });

  it("two participants get distinct scoreboard rows after judging completes", async () => {
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
      contestParticipationId: partA.id,
    });
    const subB = await createQueuedContestSubmission({
      userId: studentB.id,
      problemId: problem.id,
      contestId: contest.id,
      contestParticipationId: partB.id,
    });

    await submissionDomain.completeJudge(subA.id, {
      accepted: true,
      caseResults: [],
      feedback: "ok",
      runtimeMs: 10,
      score: 100,
      verdict: "accepted",
    });
    await submissionDomain.completeJudge(subB.id, {
      accepted: false,
      caseResults: [],
      feedback: "wa",
      runtimeMs: 10,
      score: 30,
      verdict: "wrong_answer",
    });

    await contestDomain.updateContestScores(partA.id);
    await contestDomain.updateContestScores(partB.id);

    const calls = updateScoreboardMock.mock.calls;
    const byParticipation = new Map(
      calls.map(
        ([contestId, partId, score]) =>
          [partId, { contestId, score }] as [string, { contestId: string; score: number }],
      ),
    );

    expect(byParticipation.get(partA.id)).toEqual({ contestId: contest.id, score: 100 });
    expect(byParticipation.get(partB.id)).toEqual({ contestId: contest.id, score: 30 });
  });

  it("rejudging a submission upward replays the new score onto the scoreboard", async () => {
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
      contestParticipationId: participation.id,
    });

    // First pass: WA, score 0.
    await submissionDomain.completeJudge(submission.id, {
      accepted: false,
      caseResults: [],
      feedback: "wa",
      runtimeMs: 10,
      score: 0,
      verdict: "wrong_answer",
    });
    await contestDomain.updateContestScores(participation.id);
    expect(updateScoreboardMock).toHaveBeenLastCalledWith(
      contest.id,
      participation.id,
      0,
      "ioi",
      expect.any(Number),
    );

    // Rejudge: same row gets overwritten with AC, score 100.
    await submissionDomain.completeJudge(submission.id, {
      accepted: true,
      caseResults: [],
      feedback: "ac",
      runtimeMs: 10,
      score: 100,
      verdict: "accepted",
    });
    await contestDomain.updateContestScores(participation.id);
    expect(updateScoreboardMock).toHaveBeenLastCalledWith(
      contest.id,
      participation.id,
      100,
      "ioi",
      expect.any(Number),
    );

    // Final scoreboard sees the higher score.
    const updated = await testPrisma.contestParticipation.findUnique({
      where: { id: participation.id },
    });
    expect(updated?.score).toBe(100);
  });
});
