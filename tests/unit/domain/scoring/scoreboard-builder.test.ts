import { describe, expect, it } from "vitest";

import { scoring } from "@nojv/application";

const { buildScoreboard, buildScoreboardChartSeries } = scoring;

const SESSION_START = new Date("2026-04-10T10:00:00Z");
const SESSION_END = new Date("2026-04-10T13:00:00Z");

const session = {
  id: "session_1",
  startsAt: SESSION_START,
  endsAt: SESSION_END,
  frozenAt: null as Date | null,
};

function mkParticipant(userId: string) {
  return {
    userId,
    user: { username: userId, displayUsername: null, name: userId },
  };
}

function mkProblem(id: string, ordinal: number, points = 100) {
  return { id, title: `P${ordinal}`, ordinal, points };
}

function mkSub(
  userId: string,
  problemId: string,
  score: number,
  minutesAfterStart: number,
  status = "accepted",
) {
  return {
    userId,
    problemId,
    score,
    status,
    createdAt: new Date(SESSION_START.getTime() + minutesAfterStart * 60 * 1000),
  };
}

describe("buildScoreboard (dispatcher)", () => {
  const problems = [mkProblem("P1", 1, 100), mkProblem("P2", 2, 100)];
  const participants = [mkParticipant("u1"), mkParticipant("u2")];
  const submissions = [
    mkSub("u1", "P1", 100, 5),
    mkSub("u2", "P1", 100, 15),
    mkSub("u2", "P2", 50, 25, "wrong_answer"),
  ];

  it("problem_count (解題數): each solved problem is worth 1, ranked by penalty", () => {
    const board = buildScoreboard(
      session,
      "problem_count",
      participants,
      submissions,
      problems,
      false,
    );
    expect(board[0]!.userId).toBe("u1");
    expect(board[0]!.totalScore).toBe(1);
    expect(board[0]!.totalPenalty).toBe(5 * 60);
    expect(board[1]!.totalScore).toBe(1);
    expect(board[1]!.totalPenalty).toBe(15 * 60);
  });

  it("weighted_count (積分制): each solved problem is worth its points, all-or-nothing", () => {
    const board = buildScoreboard(
      session,
      "weighted_count",
      participants,
      submissions,
      problems,
      false,
    );
    expect(board[0]!.userId).toBe("u1");
    expect(board[0]!.totalScore).toBe(100);
    expect(board[0]!.totalPenalty).toBe(5 * 60);
    // u2's 50 on P2 is a wrong_answer → not solved → contributes nothing
    expect(board[1]!.totalScore).toBe(100);
    expect(board[1]!.totalPenalty).toBe(15 * 60);
  });

  it("dispatches to IOI when scoringMode is anything else", () => {
    const board = buildScoreboard(session, "sum", participants, submissions, problems, false);
    const u2 = board.find((e) => e.userId === "u2")!;
    expect(u2.totalScore).toBe(150); // 100 (P1) + 50 (P2 partial)
    const u1 = board.find((e) => e.userId === "u1")!;
    expect(u1.totalScore).toBe(100);
    expect(board[0]!.userId).toBe("u2");
  });

  it("treats the empty string mode as IOI (non-ICPC fallback)", () => {
    const board = buildScoreboard(session, "", participants, submissions, problems, false);
    const u2 = board.find((e) => e.userId === "u2")!;
    expect(u2.totalScore).toBe(150);
  });
});

describe("buildScoreboardChartSeries", () => {
  const pointsByProblem = new Map([
    ["P1", 100],
    ["P2", 100],
  ]);

  it("returns the zero baseline for users with no submissions", () => {
    const series = buildScoreboardChartSeries(
      SESSION_START,
      "problem_count",
      ["u1"],
      new Map(),
      new Map([["u1", "alice"]]),
      pointsByProblem,
    );
    expect(series).toHaveLength(1);
    expect(series[0]!.username).toBe("alice");
    expect(series[0]!.points).toEqual([{ time: 0, score: 0 }]);
  });

  it("problem_count: each accepted solve increments cumulative score by 1, ignoring duplicates", () => {
    const subsByUser = new Map([
      [
        "u1",
        [
          mkSub("u1", "P1", 100, 10),
          mkSub("u1", "P1", 100, 15), // duplicate solve on same problem — ignored
          mkSub("u1", "P2", 100, 30),
        ],
      ],
    ]);
    const series = buildScoreboardChartSeries(
      SESSION_START,
      "problem_count",
      ["u1"],
      subsByUser,
      new Map(),
      pointsByProblem,
    );
    expect(series[0]!.points).toEqual([
      { time: 0, score: 0 },
      { time: 10 * 60, score: 1 },
      { time: 30 * 60, score: 2 },
    ]);
  });

  it("weighted_count: each accepted solve increments cumulative score by its points", () => {
    const subsByUser = new Map([
      ["u1", [mkSub("u1", "P1", 100, 10), mkSub("u1", "P2", 100, 30)]],
    ]);
    const series = buildScoreboardChartSeries(
      SESSION_START,
      "weighted_count",
      ["u1"],
      subsByUser,
      new Map(),
      pointsByProblem,
    );
    expect(series[0]!.points).toEqual([
      { time: 0, score: 0 },
      { time: 10 * 60, score: 100 },
      { time: 30 * 60, score: 200 },
    ]);
  });

  it("problem_count: wrong-answer submissions do not create chart points", () => {
    const subsByUser = new Map([
      ["u1", [mkSub("u1", "P1", 0, 5, "wrong_answer"), mkSub("u1", "P1", 100, 10)]],
    ]);
    const series = buildScoreboardChartSeries(
      SESSION_START,
      "problem_count",
      ["u1"],
      subsByUser,
      new Map(),
      pointsByProblem,
    );
    expect(series[0]!.points).toEqual([
      { time: 0, score: 0 },
      { time: 10 * 60, score: 1 },
    ]);
  });

  it("IOI: adds a chart point whenever a user improves their best score", () => {
    const subsByUser = new Map([
      [
        "u1",
        [
          mkSub("u1", "P1", 40, 5, "wrong_answer"),
          mkSub("u1", "P1", 70, 15, "wrong_answer"),
          mkSub("u1", "P1", 50, 25, "wrong_answer"), // not an improvement — skipped
          mkSub("u1", "P2", 100, 40),
        ],
      ],
    ]);
    const series = buildScoreboardChartSeries(
      SESSION_START,
      "ioi",
      ["u1"],
      subsByUser,
      new Map(),
      pointsByProblem,
    );
    expect(series[0]!.points).toEqual([
      { time: 0, score: 0 },
      { time: 5 * 60, score: 40 },
      { time: 15 * 60, score: 70 },
      { time: 40 * 60, score: 170 },
    ]);
  });

  it("IOI: cumulative score only counts the delta on each improvement", () => {
    const subsByUser = new Map([
      [
        "u1",
        [mkSub("u1", "P1", 30, 10, "wrong_answer"), mkSub("u1", "P1", 90, 20, "wrong_answer")],
      ],
    ]);
    const series = buildScoreboardChartSeries(
      SESSION_START,
      "ioi",
      ["u1"],
      subsByUser,
      new Map(),
      pointsByProblem,
    );
    expect(series[0]!.points).toEqual([
      { time: 0, score: 0 },
      { time: 10 * 60, score: 30 },
      { time: 20 * 60, score: 90 },
    ]);
  });

  it("falls back to the userId when no display username is mapped", () => {
    const series = buildScoreboardChartSeries(
      SESSION_START,
      "ioi",
      ["u1"],
      new Map(),
      new Map(),
      pointsByProblem,
    );
    expect(series[0]!.username).toBe("u1");
  });

  it("produces one series per top user, in the order they were requested", () => {
    const subsByUser = new Map([
      ["u1", [mkSub("u1", "P1", 100, 10)]],
      ["u2", [mkSub("u2", "P1", 100, 20)]],
    ]);
    const series = buildScoreboardChartSeries(
      SESSION_START,
      "problem_count",
      ["u2", "u1"],
      subsByUser,
      new Map(),
      pointsByProblem,
    );
    expect(series.map((s) => s.userId)).toEqual(["u2", "u1"]);
  });
});
