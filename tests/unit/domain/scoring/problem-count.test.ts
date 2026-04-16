import { describe, expect, it } from "vitest";

import { scoring } from "@nojv/domain";

const { computeProblemCountPenalty } = scoring;

const CONTEST_START = new Date("2026-04-10T10:00:00Z");
const PENALTY_PER_WRONG_SEC = 20 * 60;

function sub(status: string, minutesAfterStart: number) {
  return {
    status,
    createdAt: new Date(CONTEST_START.getTime() + minutesAfterStart * 60 * 1000)
  };
}

describe("computeProblemCountPenalty", () => {
  it("returns not-solved for an empty submission list", () => {
    expect(computeProblemCountPenalty([], CONTEST_START)).toEqual({
      solved: false,
      wrongAttempts: 0,
      firstAcTimeSec: null,
      penaltySeconds: 0
    });
  });

  it("returns just the solve time when the first submission is AC", () => {
    const r = computeProblemCountPenalty([sub("accepted", 30)], CONTEST_START);
    expect(r).toEqual({
      solved: true,
      wrongAttempts: 0,
      firstAcTimeSec: 30 * 60,
      penaltySeconds: 30 * 60
    });
  });

  it("adds 20 minutes per prior wrong attempt", () => {
    const subs = [sub("wrong_answer", 5), sub("wrong_answer", 10), sub("accepted", 15)];
    const r = computeProblemCountPenalty(subs, CONTEST_START);
    expect(r.solved).toBe(true);
    expect(r.penaltySeconds).toBe(15 * 60 + 2 * PENALTY_PER_WRONG_SEC);
  });

  it("treats TLE/MLE/RE/compile_error as wrong attempts", () => {
    const subs = [
      sub("time_limit_exceeded", 1),
      sub("memory_limit_exceeded", 2),
      sub("runtime_error", 3),
      sub("compile_error", 4),
      sub("accepted", 5)
    ];
    const r = computeProblemCountPenalty(subs, CONTEST_START);
    expect(r.solved).toBe(true);
    expect(r.penaltySeconds).toBe(5 * 60 + 4 * PENALTY_PER_WRONG_SEC);
  });

  it("skips in-progress statuses (queued/compiling/running) — regression for L40 fix", () => {
    const subs = [
      sub("wrong_answer", 5),
      sub("running", 8),
      sub("queued", 9),
      sub("compiling", 9),
      sub("accepted", 10)
    ];
    const r = computeProblemCountPenalty(subs, CONTEST_START);
    expect(r.solved).toBe(true);
    // Only the one real WA counts — the three in-progress rows must not.
    expect(r.penaltySeconds).toBe(10 * 60 + 1 * PENALTY_PER_WRONG_SEC);
  });

  it("ignores submissions after the first AC", () => {
    const subs = [
      sub("wrong_answer", 5),
      sub("accepted", 10),
      sub("wrong_answer", 15),
      sub("accepted", 20)
    ];
    const r = computeProblemCountPenalty(subs, CONTEST_START);
    expect(r.penaltySeconds).toBe(10 * 60 + 1 * PENALTY_PER_WRONG_SEC);
  });

  it("returns not-solved when every judged submission is wrong", () => {
    const subs = [sub("wrong_answer", 5), sub("time_limit_exceeded", 10)];
    expect(computeProblemCountPenalty(subs, CONTEST_START)).toEqual({
      solved: false,
      wrongAttempts: 2,
      firstAcTimeSec: null,
      penaltySeconds: 0
    });
  });

  it("returns not-solved when only in-progress submissions exist", () => {
    const subs = [sub("queued", 5), sub("running", 10), sub("compiling", 15)];
    expect(computeProblemCountPenalty(subs, CONTEST_START)).toEqual({
      solved: false,
      wrongAttempts: 0,
      firstAcTimeSec: null,
      penaltySeconds: 0
    });
  });

  it("clamps firstAcTimeSec to 0 for submissions timestamped before contest start", () => {
    const preContest = new Date(CONTEST_START.getTime() - 5000);
    const r = computeProblemCountPenalty(
      [{ status: "accepted", createdAt: preContest }],
      CONTEST_START
    );
    expect(r.firstAcTimeSec).toBe(0);
    expect(r.penaltySeconds).toBe(0);
  });

  it("floors sub-second solve time differences", () => {
    const almostOneMinute = new Date(CONTEST_START.getTime() + 59_999);
    const r = computeProblemCountPenalty(
      [{ status: "accepted", createdAt: almostOneMinute }],
      CONTEST_START
    );
    expect(r.penaltySeconds).toBe(59);
  });
});
