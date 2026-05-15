import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findByIdWithExam,
  findMany,
  findAllByContext,
  updateWithVersion,
  updateScoreboardMock,
  ExamParticipationVersionConflict,
} = vi.hoisted(() => {
  class ExamParticipationVersionConflict extends Error {
    readonly participationId: string;
    readonly expectedVersion: number;
    constructor(participationId: string, expectedVersion: number) {
      super(`ExamParticipation ${participationId} version ${String(expectedVersion)} stale.`);
      this.name = "ExamParticipationVersionConflict";
      this.participationId = participationId;
      this.expectedVersion = expectedVersion;
    }
  }
  return {
    findByIdWithExam: vi.fn(),
    findMany: vi.fn(),
    findAllByContext: vi.fn(),
    updateWithVersion: vi.fn(),
    updateScoreboardMock: vi.fn(),
    ExamParticipationVersionConflict,
  };
});

vi.mock("@nojv/db", () => ({
  examParticipationRepo: {
    findByIdWithExam,
    updateWithVersion,
  },
  examRepo: {},
  submissionRepo: {
    findMany,
  },
  scoreOverrideRepo: {
    findAllByContext,
  },
  ExamParticipationVersionConflict,
}));

vi.mock("@nojv/redis", () => ({
  scoreboard: {
    updateScoreboard: updateScoreboardMock,
  },
}));

import { examDomain, ConflictError } from "@nojv/domain";

const { updateExamScores } = examDomain;

const PARTICIPATION_ID = "ep_1";
const EXAM_ID = "ex_1";
const USER_ID = "usr_student";
const PROBLEM_ID = "prob_1";

function participationFixture(version: number) {
  return {
    id: PARTICIPATION_ID,
    examId: EXAM_ID,
    userId: USER_ID,
    score: 0,
    penaltySeconds: 0,
    subtaskScores: null,
    version,
    exam: {
      id: EXAM_ID,
      startsAt: new Date("2026-05-15T10:00:00Z"),
      scoringMode: "point_sum",
      problems: [{ problemId: PROBLEM_ID, ordinal: 1, points: 100 }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findAllByContext.mockResolvedValue([]);
  updateScoreboardMock.mockResolvedValue(undefined);
});

describe("updateExamScores — optimistic locking", () => {
  it("retries after a version conflict and persists the latest computed score (point_sum)", async () => {
    // First read: version 0, submissions show best score 60.
    // Retry read: version 1 (a concurrent writer landed), submissions now
    //   show best score 80 — we must persist 80, not 60.
    findByIdWithExam
      .mockResolvedValueOnce(participationFixture(0))
      .mockResolvedValueOnce(participationFixture(1));

    findMany
      .mockResolvedValueOnce([
        { problemId: PROBLEM_ID, score: 60, status: "partial", createdAt: new Date() },
      ])
      .mockResolvedValueOnce([
        { problemId: PROBLEM_ID, score: 80, status: "partial", createdAt: new Date() },
      ]);

    updateWithVersion
      .mockImplementationOnce(() => {
        throw new ExamParticipationVersionConflict(PARTICIPATION_ID, 0);
      })
      .mockResolvedValueOnce({ id: PARTICIPATION_ID, score: 80, version: 2 });

    await updateExamScores(PARTICIPATION_ID);

    expect(findByIdWithExam).toHaveBeenCalledTimes(2);
    expect(updateWithVersion).toHaveBeenCalledTimes(2);

    // First call used the stale version 0 with the stale score.
    expect(updateWithVersion).toHaveBeenNthCalledWith(
      1,
      PARTICIPATION_ID,
      0,
      expect.objectContaining({ score: 60 }),
    );

    // Retry used the freshly read version 1 with the recomputed score.
    expect(updateWithVersion).toHaveBeenNthCalledWith(
      2,
      PARTICIPATION_ID,
      1,
      expect.objectContaining({ score: 80 }),
    );

    // Scoreboard reflects the value that actually landed.
    expect(updateScoreboardMock).toHaveBeenCalledTimes(1);
    expect(updateScoreboardMock).toHaveBeenCalledWith(EXAM_ID, PARTICIPATION_ID, 80, "ioi");
  });

  it("uses optimistic locking on the problem_count (ICPC) path too", async () => {
    const icpcFixture = (version: number) => {
      const f = participationFixture(version);
      f.exam.scoringMode = "problem_count";
      return f;
    };
    findByIdWithExam.mockResolvedValue(icpcFixture(0));
    // One accepted submission → 1 problem solved.
    findMany.mockResolvedValue([
      {
        problemId: PROBLEM_ID,
        score: 100,
        status: "accepted",
        createdAt: new Date("2026-05-15T10:30:00Z"),
      },
    ]);
    updateWithVersion.mockResolvedValue({ id: PARTICIPATION_ID, version: 1 });

    await updateExamScores(PARTICIPATION_ID);

    expect(updateWithVersion).toHaveBeenCalledTimes(1);
    expect(updateWithVersion).toHaveBeenCalledWith(
      PARTICIPATION_ID,
      0,
      expect.objectContaining({ score: 1 }),
    );
    expect(updateScoreboardMock).toHaveBeenCalledWith(
      EXAM_ID,
      PARTICIPATION_ID,
      expect.any(Number),
      "icpc",
    );
  });

  it("throws ConflictError after exhausting all retry attempts", async () => {
    findByIdWithExam.mockResolvedValue(participationFixture(0));
    findMany.mockResolvedValue([
      { problemId: PROBLEM_ID, score: 50, status: "partial", createdAt: new Date() },
    ]);
    updateWithVersion.mockImplementation(() => {
      throw new ExamParticipationVersionConflict(PARTICIPATION_ID, 0);
    });

    await expect(updateExamScores(PARTICIPATION_ID)).rejects.toBeInstanceOf(ConflictError);

    // 3 attempts before giving up.
    expect(updateWithVersion).toHaveBeenCalledTimes(3);
    // Scoreboard must NOT be touched when no DB write succeeded.
    expect(updateScoreboardMock).not.toHaveBeenCalled();
  });

  it("returns early without writing when the participation does not exist", async () => {
    findByIdWithExam.mockResolvedValue(null);

    await updateExamScores(PARTICIPATION_ID);

    expect(updateWithVersion).not.toHaveBeenCalled();
    expect(updateScoreboardMock).not.toHaveBeenCalled();
  });
});
