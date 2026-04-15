import { describe, expect, it } from "vitest";

import { scoring } from "@nojv/domain";

const { buildIoiScoreboard } = scoring;

const SESSION_START = new Date("2026-04-10T10:00:00Z");
const SESSION_END = new Date("2026-04-10T13:00:00Z");

const session = {
  id: "session_1",
  startsAt: SESSION_START,
  endsAt: SESSION_END,
  frozenAt: null as Date | null
};

function mkParticipant(userId: string, name = userId) {
  return {
    userId,
    user: { username: userId, displayUsername: null, name }
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
  status = "accepted"
) {
  return {
    userId,
    problemId,
    score,
    status,
    createdAt: new Date(SESSION_START.getTime() + minutesAfterStart * 60 * 1000)
  };
}

describe("buildIoiScoreboard", () => {
  it("returns empty entries when there are no participants", () => {
    const board = buildIoiScoreboard(session, [], [], [mkProblem("P1", 1)], false);
    expect(board).toEqual([]);
  });

  it("assigns rank 1 to the only participant with zero submissions", () => {
    const board = buildIoiScoreboard(
      session,
      [mkParticipant("u1")],
      [],
      [mkProblem("P1", 1)],
      false
    );
    expect(board).toHaveLength(1);
    const entry = board[0]!;
    expect(entry.rank).toBe(1);
    expect(entry.totalScore).toBe(0);
    expect(entry.totalPenalty).toBe(0);
    expect(entry.problems[0]).toMatchObject({ score: 0, attempts: 0, firstAcTime: null });
    expect(entry.isFirstBlood[0]).toBe(false);
  });

  it("keeps only the highest score per problem when users improve", () => {
    const problems = [mkProblem("P1", 1, 100)];
    const submissions = [
      mkSub("u1", "P1", 40, 5, "wrong_answer"),
      mkSub("u1", "P1", 70, 15, "wrong_answer"),
      mkSub("u1", "P1", 50, 25, "wrong_answer")
    ];
    const board = buildIoiScoreboard(
      session,
      [mkParticipant("u1")],
      submissions,
      problems,
      false
    );
    expect(board[0]!.totalScore).toBe(70);
    expect(board[0]!.problems[0]!.score).toBe(70);
    expect(board[0]!.problems[0]!.attempts).toBe(3);
    expect(board[0]!.problems[0]!.firstAcTime).toBeNull();
  });

  it("sorts tied-score users by last-improvement time but still shares the rank", () => {
    const problems = [mkProblem("P1", 1, 100), mkProblem("P2", 2, 100)];
    const participants = [
      mkParticipant("fast"),
      mkParticipant("slow"),
      mkParticipant("leader")
    ];
    const submissions = [
      mkSub("fast", "P1", 60, 5),
      mkSub("fast", "P2", 60, 10),
      mkSub("slow", "P1", 60, 20),
      mkSub("slow", "P2", 60, 40),
      mkSub("leader", "P1", 100, 30),
      mkSub("leader", "P2", 100, 60)
    ];
    const board = buildIoiScoreboard(session, participants, submissions, problems, false);
    // Order in the array reflects the comparator: higher score first,
    // then lower last-improvement time as a display-side tie-breaker.
    expect(board.map((e) => e.userId)).toEqual(["leader", "fast", "slow"]);
    expect(board[1]!.totalPenalty).toBeLessThan(board[2]!.totalPenalty);
    // Rank is IOI-style: leader is rank 1, fast and slow share rank 2
    // because they have identical total scores.
    expect(board[0]!.rank).toBe(1);
    expect(board[1]!.rank).toBe(2);
    expect(board[2]!.rank).toBe(2);
  });

  it("treats tied total scores as the same rank (IOI ignores penalty for rank ties)", () => {
    const problems = [mkProblem("P1", 1, 100)];
    const participants = [mkParticipant("a"), mkParticipant("b"), mkParticipant("c")];
    const submissions = [
      mkSub("a", "P1", 50, 5),
      mkSub("b", "P1", 50, 20),
      mkSub("c", "P1", 80, 10)
    ];
    const board = buildIoiScoreboard(session, participants, submissions, problems, false);
    expect(board.map((e) => [e.userId, e.rank, e.totalScore])).toEqual([
      ["c", 1, 80],
      ["a", 2, 50],
      ["b", 2, 50]
    ]);
  });

  it("marks first blood for the earliest user to reach full score on each problem", () => {
    const problems = [mkProblem("P1", 1, 100), mkProblem("P2", 2, 100)];
    const participants = [mkParticipant("early"), mkParticipant("late")];
    const submissions = [
      mkSub("early", "P1", 100, 5),
      mkSub("late", "P1", 100, 10),
      mkSub("late", "P2", 100, 15),
      mkSub("early", "P2", 100, 20)
    ];
    const board = buildIoiScoreboard(session, participants, submissions, problems, false);
    const early = board.find((e) => e.userId === "early")!;
    const late = board.find((e) => e.userId === "late")!;
    expect(early.isFirstBlood).toEqual([true, false]);
    expect(late.isFirstBlood).toEqual([false, true]);
  });

  it("does not grant first blood if the participant never reaches full points", () => {
    const problems = [mkProblem("P1", 1, 100)];
    const participants = [mkParticipant("u1")];
    const submissions = [mkSub("u1", "P1", 99, 5, "wrong_answer")];
    const board = buildIoiScoreboard(session, participants, submissions, problems, false);
    expect(board[0]!.isFirstBlood[0]).toBe(false);
  });

  it("hides post-freeze submissions and flags the cell frozen when showFrozen=true", () => {
    const frozenAt = new Date(SESSION_START.getTime() + 30 * 60 * 1000);
    const sessionFrozen = { ...session, frozenAt };
    const problems = [mkProblem("P1", 1, 100)];
    const participants = [mkParticipant("u1")];
    const submissions = [
      mkSub("u1", "P1", 50, 10, "wrong_answer"),
      mkSub("u1", "P1", 90, 40, "wrong_answer")
    ];
    const board = buildIoiScoreboard(sessionFrozen, participants, submissions, problems, true);
    const cell = board[0]!.problems[0]!;
    expect(cell.score).toBe(50);
    expect(cell.isFrozen).toBe(true);
    expect(cell.isPending).toBe(true);
  });

  it("ignores the freeze boundary when showFrozen=false", () => {
    const frozenAt = new Date(SESSION_START.getTime() + 30 * 60 * 1000);
    const sessionFrozen = { ...session, frozenAt };
    const problems = [mkProblem("P1", 1, 100)];
    const participants = [mkParticipant("u1")];
    const submissions = [
      mkSub("u1", "P1", 50, 10, "wrong_answer"),
      mkSub("u1", "P1", 90, 40, "wrong_answer")
    ];
    const board = buildIoiScoreboard(sessionFrozen, participants, submissions, problems, false);
    const cell = board[0]!.problems[0]!;
    expect(cell.score).toBe(90);
    expect(cell.isFrozen).toBe(false);
  });

  it("exposes displayUsername when the participant record has one", () => {
    const participants = [
      {
        userId: "u1",
        user: { username: "u1", displayUsername: "DisplayName", name: "Real Name" }
      }
    ];
    const board = buildIoiScoreboard(session, participants, [], [mkProblem("P1", 1)], false);
    expect(board[0]!.username).toBe("DisplayName");
    expect(board[0]!.displayName).toBe("Real Name");
  });
});
