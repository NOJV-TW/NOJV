import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findExamForScoring,
  findMany,
  findAllByContext,
  updateWithVersion,
  UnifiedParticipationVersionConflict,
} = vi.hoisted(() => {
  class UnifiedParticipationVersionConflict extends Error {
    readonly participationId: string;
    readonly expectedVersion: number;
    constructor(participationId: string, expectedVersion: number) {
      super(`Participation ${participationId} version ${String(expectedVersion)} stale.`);
      this.name = "UnifiedParticipationVersionConflict";
      this.participationId = participationId;
      this.expectedVersion = expectedVersion;
    }
  }
  return {
    findExamForScoring: vi.fn(),
    findMany: vi.fn(),
    findAllByContext: vi.fn(),
    updateWithVersion: vi.fn(),
    UnifiedParticipationVersionConflict,
  };
});

vi.mock("@nojv/db", () => ({
  participationRepo: {
    findExamForScoring,
    updateWithVersion,
  },
  examRepo: {},
  submissionRepo: {
    findMany,
  },
  scoreOverrideRepo: {
    findAllByContext,
  },
  UnifiedParticipationVersionConflict,
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
});

describe("updateExamScores — optimistic locking", () => {
  it("retries after a version conflict and persists the latest computed score (point_sum)", async () => {
    findExamForScoring
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
        throw new UnifiedParticipationVersionConflict(PARTICIPATION_ID, 0);
      })
      .mockResolvedValueOnce({ id: PARTICIPATION_ID, score: 80, version: 2 });

    await updateExamScores(EXAM_ID, USER_ID);

    expect(findExamForScoring).toHaveBeenCalledTimes(2);
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

  it("uses optimistic locking on the problem_count (ICPC) path too", async () => {
    const icpcFixture = (version: number) => {
      const f = participationFixture(version);
      f.exam.scoringMode = "problem_count";
      return f;
    };
    findExamForScoring.mockResolvedValue(icpcFixture(0));
    findMany.mockResolvedValue([
      {
        problemId: PROBLEM_ID,
        score: 100,
        status: "accepted",
        createdAt: new Date("2026-05-15T10:30:00Z"),
      },
    ]);
    updateWithVersion.mockResolvedValue({ id: PARTICIPATION_ID, version: 1 });

    await updateExamScores(EXAM_ID, USER_ID);

    expect(updateWithVersion).toHaveBeenCalledTimes(1);
    expect(updateWithVersion).toHaveBeenCalledWith(
      PARTICIPATION_ID,
      0,
      expect.objectContaining({ score: 1 }),
    );
  });

  it("throws ConflictError after exhausting all retry attempts", async () => {
    findExamForScoring.mockResolvedValue(participationFixture(0));
    findMany.mockResolvedValue([
      { problemId: PROBLEM_ID, score: 50, status: "partial", createdAt: new Date() },
    ]);
    updateWithVersion.mockImplementation(() => {
      throw new UnifiedParticipationVersionConflict(PARTICIPATION_ID, 0);
    });

    await expect(updateExamScores(EXAM_ID, USER_ID)).rejects.toBeInstanceOf(ConflictError);

    expect(updateWithVersion).toHaveBeenCalledTimes(3);
  });

  it("returns early without writing when the participation does not exist", async () => {
    findExamForScoring.mockResolvedValue(null);

    await updateExamScores(EXAM_ID, USER_ID);

    expect(updateWithVersion).not.toHaveBeenCalled();
  });
});

describe("updateExamScores — judge-pipeline entry point", () => {
  it("resolves the participation for (exam, user) and recomputes its score", async () => {
    findExamForScoring.mockResolvedValue(participationFixture(0));
    findMany.mockResolvedValue([
      { problemId: PROBLEM_ID, score: 80, status: "partial", createdAt: new Date() },
    ]);
    updateWithVersion.mockResolvedValue({ id: PARTICIPATION_ID, score: 80, version: 1 });

    await updateExamScores(EXAM_ID, USER_ID);

    expect(findExamForScoring).toHaveBeenCalledWith(EXAM_ID, USER_ID);
    expect(updateWithVersion).toHaveBeenCalledWith(
      PARTICIPATION_ID,
      0,
      expect.objectContaining({ score: 80 }),
    );
  });

  it("no-ops when the user has no participation row yet", async () => {
    findExamForScoring.mockResolvedValue(null);

    await updateExamScores(EXAM_ID, USER_ID);

    expect(updateWithVersion).not.toHaveBeenCalled();
  });
});
