import { beforeEach, describe, expect, it, vi } from "vitest";

const { findExamForScoring, findMany, findAllByContext, updateWithVersion } = vi.hoisted(
  () => ({
    findExamForScoring: vi.fn(),
    findMany: vi.fn(),
    findAllByContext: vi.fn(),
    updateWithVersion: vi.fn(),
  }),
);

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
  UnifiedParticipationVersionConflict: class extends Error {},
}));

import { examDomain } from "@nojv/application";

const { updateExamScores } = examDomain;

const PARTICIPATION_ID = "ep_1";
const EXAM_ID = "ex_1";
const USER_ID = "usr_student";
const PROBLEM_ID = "prob_1";
const ENDS_AT = new Date("2026-05-15T12:00:00Z");

function participationFixture() {
  return {
    id: PARTICIPATION_ID,
    examId: EXAM_ID,
    userId: USER_ID,
    score: 0,
    penaltySeconds: 0,
    subtaskScores: null,
    version: 0,
    exam: {
      id: EXAM_ID,
      startsAt: new Date("2026-05-15T10:00:00Z"),
      endsAt: ENDS_AT,
      scoringMode: "point_sum",
      problems: [{ problemId: PROBLEM_ID, ordinal: 1, points: 100 }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findAllByContext.mockResolvedValue([]);
});

describe("updateExamScores — read-side time cutoff", () => {
  it("queries submissions with a createdAt <= endsAt cutoff", async () => {
    findExamForScoring.mockResolvedValue(participationFixture());
    findMany.mockResolvedValue([]);
    updateWithVersion.mockResolvedValue({ id: PARTICIPATION_ID, score: 0, version: 1 });

    await updateExamScores(EXAM_ID, USER_ID);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          examId: EXAM_ID,
          userId: USER_ID,
          sampleOnly: false,
          createdAt: { lte: ENDS_AT },
        }),
      }),
    );
  });

  it("excludes a submission created after endsAt from the exam score", async () => {
    findExamForScoring.mockResolvedValue(participationFixture());

    findMany.mockImplementation((query: { where: { createdAt?: { lte: Date } } }) => {
      const cutoff = query.where.createdAt?.lte;
      const allRows = [
        {
          problemId: PROBLEM_ID,
          score: 40,
          status: "partial",
          createdAt: new Date("2026-05-15T11:00:00Z"),
        },
        {
          problemId: PROBLEM_ID,
          score: 100,
          status: "accepted",
          createdAt: new Date("2026-05-15T13:00:00Z"),
        },
      ];
      return Promise.resolve(cutoff ? allRows.filter((r) => r.createdAt <= cutoff) : allRows);
    });

    updateWithVersion.mockResolvedValue({ id: PARTICIPATION_ID, version: 1 });

    await updateExamScores(EXAM_ID, USER_ID);

    expect(updateWithVersion).toHaveBeenCalledWith(
      PARTICIPATION_ID,
      0,
      expect.objectContaining({ score: 40 }),
    );
  });
});
