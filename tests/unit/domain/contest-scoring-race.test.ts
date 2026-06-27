import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findContestForScoring,
  findForContestScoring,
  findAllByContext,
  updateWithVersion,
  UnifiedParticipationVersionConflict,
} = vi.hoisted(() => {
  class UnifiedParticipationVersionConflict extends Error {
    readonly participationId: string;
    readonly expectedVersion: number;
    constructor(participationId: string, expectedVersion: number) {
      super(
        `Participation ${participationId} version ${String(expectedVersion)} no longer current.`,
      );
      this.name = "UnifiedParticipationVersionConflict";
      this.participationId = participationId;
      this.expectedVersion = expectedVersion;
    }
  }
  return {
    findContestForScoring: vi.fn(),
    findForContestScoring: vi.fn(),
    findAllByContext: vi.fn(),
    updateWithVersion: vi.fn(),
    UnifiedParticipationVersionConflict,
  };
});

vi.mock("@nojv/db", () => ({
  participationRepo: {
    findContestForScoring,
    updateWithVersion,
  },
  submissionRepo: {
    findForContestScoring,
  },
  scoreOverrideRepo: {
    findAllByContext,
  },
  contestRepo: {},
  UnifiedParticipationVersionConflict,
}));

import { contestDomain, ConflictError } from "@nojv/application";

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
      endsAt: new Date("2026-04-29T12:00:00Z"),
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
    findContestForScoring
      .mockResolvedValueOnce(participationFixture(0))
      .mockResolvedValueOnce(participationFixture(1));

    findForContestScoring
      .mockResolvedValueOnce([
        {
          problemId: PROBLEM_ID,
          score: 60,
          status: "wrong_answer",
          createdAt: new Date("2026-04-29T11:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          problemId: PROBLEM_ID,
          score: 80,
          status: "partial",
          createdAt: new Date("2026-04-29T11:00:00Z"),
        },
      ]);

    updateWithVersion
      .mockImplementationOnce(() => {
        throw new UnifiedParticipationVersionConflict(PARTICIPATION_ID, 0);
      })
      .mockResolvedValueOnce({ id: PARTICIPATION_ID, score: 80, version: 2 });

    await updateContestScores(CONTEST_ID, USER_ID);

    expect(findContestForScoring).toHaveBeenCalledTimes(2);
    expect(updateWithVersion).toHaveBeenCalledTimes(2);

    expect(updateWithVersion).toHaveBeenNthCalledWith(
      1,
      PARTICIPATION_ID,
      0,
      expect.objectContaining({ score: 60 }),
    );

    expect(updateWithVersion).toHaveBeenNthCalledWith(
      2,
      PARTICIPATION_ID,
      1,
      expect.objectContaining({ score: 80 }),
    );
  });

  it("throws ConflictError after exhausting all retry attempts", async () => {
    findContestForScoring.mockResolvedValue(participationFixture(0));
    findForContestScoring.mockResolvedValue([
      {
        problemId: PROBLEM_ID,
        score: 50,
        status: "partial",
        createdAt: new Date("2026-04-29T11:00:00Z"),
      },
    ]);
    updateWithVersion.mockImplementation(() => {
      throw new UnifiedParticipationVersionConflict(PARTICIPATION_ID, 0);
    });

    await expect(updateContestScores(CONTEST_ID, USER_ID)).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(updateWithVersion).toHaveBeenCalledTimes(3);
  });
});
