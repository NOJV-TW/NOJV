import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findByIdWithContest,
  findForParticipationScoring,
  findAllByContext,
  updateWithVersion,
  ParticipationVersionConflict,
} = vi.hoisted(() => {
  class ParticipationVersionConflict extends Error {
    readonly participationId: string;
    readonly expectedVersion: number;
    constructor(participationId: string, expectedVersion: number) {
      super(
        `ContestParticipation ${participationId} version ${String(expectedVersion)} stale.`,
      );
      this.name = "ParticipationVersionConflict";
      this.participationId = participationId;
      this.expectedVersion = expectedVersion;
    }
  }
  return {
    findByIdWithContest: vi.fn(),
    findForParticipationScoring: vi.fn(),
    findAllByContext: vi.fn(),
    updateWithVersion: vi.fn(),
    ParticipationVersionConflict,
  };
});

vi.mock("@nojv/db", () => ({
  contestParticipationRepo: {
    findByIdWithContest,
    updateWithVersion,
  },
  submissionRepo: {
    findForParticipationScoring,
  },
  scoreOverrideRepo: {
    findAllByContext,
  },
  contestRepo: {},
  ParticipationVersionConflict,
}));

import { contestDomain, ConflictError } from "@nojv/domain";

const { updateContestScores } = contestDomain;

const PARTICIPATION_ID = "cp_1";
const CONTEST_ID = "c_1";
const USER_ID = "usr_student";
const PROBLEM_ID = "prob_1";

function participationFixture(version: number) {
  return {
    id: PARTICIPATION_ID,
    contestId: CONTEST_ID,
    userId: USER_ID,
    score: 0,
    penaltySeconds: 0,
    subtaskScores: null,
    version,
    contest: {
      id: CONTEST_ID,
      startsAt: new Date("2026-04-29T10:00:00Z"),
      scoringMode: "point_sum",
      problems: [{ problemId: PROBLEM_ID, ordinal: 1, points: 100 }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findAllByContext.mockResolvedValue([]);
});

describe("updateContestScores — optimistic locking", () => {
  it("retries after a P2025/version conflict and persists the latest computed score", async () => {
    // First read: version 0, submissions show score 60.
    // Second read (after retry): version 1 (someone else wrote), submissions
    //   now show score 80. We must end up persisting 80, not 60.
    findByIdWithContest
      .mockResolvedValueOnce(participationFixture(0))
      .mockResolvedValueOnce(participationFixture(1));

    findForParticipationScoring
      .mockResolvedValueOnce([
        { problemId: PROBLEM_ID, score: 60, status: "wrong_answer", createdAt: new Date() },
      ])
      .mockResolvedValueOnce([
        { problemId: PROBLEM_ID, score: 80, status: "partial", createdAt: new Date() },
      ]);

    updateWithVersion
      .mockImplementationOnce(() => {
        throw new ParticipationVersionConflict(PARTICIPATION_ID, 0);
      })
      .mockResolvedValueOnce({ id: PARTICIPATION_ID, score: 80, version: 2 });

    await updateContestScores(PARTICIPATION_ID);

    expect(findByIdWithContest).toHaveBeenCalledTimes(2);
    expect(updateWithVersion).toHaveBeenCalledTimes(2);

    // First call used version 0 with the stale score.
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
  });

  it("throws ConflictError after exhausting all retry attempts", async () => {
    findByIdWithContest.mockResolvedValue(participationFixture(0));
    findForParticipationScoring.mockResolvedValue([
      { problemId: PROBLEM_ID, score: 50, status: "partial", createdAt: new Date() },
    ]);
    updateWithVersion.mockImplementation(() => {
      throw new ParticipationVersionConflict(PARTICIPATION_ID, 0);
    });

    await expect(updateContestScores(PARTICIPATION_ID)).rejects.toBeInstanceOf(ConflictError);

    // 3 attempts before giving up.
    expect(updateWithVersion).toHaveBeenCalledTimes(3);
  });
});
