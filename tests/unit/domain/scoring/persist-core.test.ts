import { describe, expect, it } from "vitest";

import {
  computeBestScoreState,
  computeProblemCountState,
} from "../../../../packages/domain/src/scoring/persist-core";

describe("computeBestScoreState", () => {
  it("keeps the highest score per problem and sums into totalScore", () => {
    const state = computeBestScoreState({
      submissions: [
        { problemId: "p1", score: 30 },
        { problemId: "p1", score: 80 },
        { problemId: "p2", score: 50 },
      ],
      problemIds: new Set(["p1", "p2"]),
      overrides: [],
      userId: "u1",
    });

    expect(state).toEqual({ totalScore: 130, subtaskScores: { p1: 80, p2: 50 } });
  });

  it("ignores submissions whose problem is not in the problem set", () => {
    const state = computeBestScoreState({
      submissions: [
        { problemId: "p1", score: 40 },
        { problemId: "ghost", score: 100 },
      ],
      problemIds: new Set(["p1"]),
      overrides: [],
      userId: "u1",
    });

    expect(state).toEqual({ totalScore: 40, subtaskScores: { p1: 40 } });
  });

  it("applies an override unconditionally — it may LOWER the best score", () => {
    const state = computeBestScoreState({
      submissions: [{ problemId: "p1", score: 100 }],
      problemIds: new Set(["p1"]),
      overrides: [{ userId: "u1", problemId: "p1", overrideScore: 25 }],
      userId: "u1",
    });

    expect(state).toEqual({ totalScore: 25, subtaskScores: { p1: 25 } });
  });

  it("only applies overrides belonging to the participation user", () => {
    const state = computeBestScoreState({
      submissions: [{ problemId: "p1", score: 60 }],
      problemIds: new Set(["p1"]),
      overrides: [
        { userId: "other", problemId: "p1", overrideScore: 0 },
        { userId: "u1", problemId: "p1", overrideScore: 90 },
      ],
      userId: "u1",
    });

    expect(state).toEqual({ totalScore: 90, subtaskScores: { p1: 90 } });
  });

  it("ignores overrides for problems outside the problem set", () => {
    const state = computeBestScoreState({
      submissions: [{ problemId: "p1", score: 10 }],
      problemIds: new Set(["p1"]),
      overrides: [{ userId: "u1", problemId: "ghost", overrideScore: 100 }],
      userId: "u1",
    });

    expect(state).toEqual({ totalScore: 10, subtaskScores: { p1: 10 } });
  });

  it("returns an empty state when there is nothing scored", () => {
    expect(
      computeBestScoreState({
        submissions: [],
        problemIds: new Set(["p1"]),
        overrides: [],
        userId: "u1",
      }),
    ).toEqual({ totalScore: 0, subtaskScores: {} });
  });
});

describe("computeProblemCountState", () => {
  const startsAt = new Date("2026-01-01T00:00:00.000Z");
  const at = (minutes: number) => new Date(startsAt.getTime() + minutes * 60_000);

  it("counts solved problems and sums ICPC-style penalty (first AC time + 20min/wrong)", () => {
    const state = computeProblemCountState({
      submissions: [
        { problemId: "p1", status: "wrong_answer", createdAt: at(5) },
        { problemId: "p1", status: "accepted", createdAt: at(10) },
        { problemId: "p2", status: "wrong_answer", createdAt: at(3) },
      ],
      problemIds: new Set(["p1", "p2"]),
      startsAt,
    });

    expect(state.score).toBe(1);
    expect(state.penaltySeconds).toBe(10 * 60 + 1 * 20 * 60);
  });

  it("ignores submissions whose problem is not in the problem set", () => {
    const state = computeProblemCountState({
      submissions: [{ problemId: "ghost", status: "accepted", createdAt: at(1) }],
      problemIds: new Set(["p1"]),
      startsAt,
    });

    expect(state).toEqual({ score: 0, penaltySeconds: 0 });
  });
});
