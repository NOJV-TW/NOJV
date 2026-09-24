import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  redis,
  findForScoreboardById,
  findInfoById,
  findForContestScoreboardByContestId,
  findForContestChartByContestId,
  findContestScoreboardParticipants,
} = vi.hoisted(() => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), eval: vi.fn() },
  findForScoreboardById: vi.fn(),
  findInfoById: vi.fn(),
  findForContestScoreboardByContestId: vi.fn(),
  findForContestChartByContestId: vi.fn(),
  findContestScoreboardParticipants: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: {
    findForScoreboardById,
    findInfoById,
  },
  submissionRepo: {
    findForContestScoreboardByContestId,
    findForContestChartByContestId,
  },
  participationRepo: {
    findContestScoreboardParticipants,
  },
  scoreOverrideRepo: {},
  UnifiedParticipationVersionConflict: class extends Error {},
}));

vi.mock("@nojv/redis", () => ({
  createRateLimiterConnection: () => redis,
  keys: {
    scoreboardCache: (contestId: string, variant: string) => `sb:${contestId}:${variant}`,
    scoreboardChartCache: (contestId: string, variant: string, topN: number) =>
      `sb-chart:${contestId}:${variant}:${topN}`,
    scoreboardLock: (contestId: string, variant: string) => `sb-lock:${contestId}:${variant}`,
  },
}));

import { contestDomain } from "@nojv/application";

const { getScoreboardChart } = contestDomain;

const START = new Date("2026-04-10T10:00:00Z");
const END = new Date("2026-04-10T13:00:00Z");
const FROZEN_AT = new Date("2026-04-10T12:00:00Z");

function minutes(n: number): Date {
  return new Date(START.getTime() + n * 60 * 1000);
}

function mkSub(userId: string, problemId: string, score: number, minutesAfterStart: number) {
  return {
    userId,
    createdAt: minutes(minutesAfterStart),
    problemId,
    score,
    status: "accepted",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue("OK");
  redis.del.mockResolvedValue(0);
  redis.eval.mockResolvedValue(1);

  findForScoreboardById.mockResolvedValue({
    endsAt: END,
    frozenAt: FROZEN_AT,
    frozenBoard: true,
    id: "contest-1",
    problems: [
      { ordinal: 1, points: 100, problem: { title: "P1" }, problemId: "P1" },
      { ordinal: 2, points: 100, problem: { title: "P2" }, problemId: "P2" },
    ],
    scoreboardMode: "visible",
    scoringMode: "weighted_count",
    startsAt: START,
    visibility: "public",
  });

  findInfoById.mockResolvedValue({
    endsAt: END,
    frozenAt: FROZEN_AT,
    scoringMode: "weighted_count",
    startsAt: START,
  });

  findContestScoreboardParticipants.mockResolvedValue([
    { userId: "u1", user: { displayUsername: null, name: "u1", username: "u1" } },
    { userId: "u2", user: { displayUsername: null, name: "u2", username: "u2" } },
  ]);

  const submissions = [
    mkSub("u2", "P1", 100, 20),
    mkSub("u1", "P1", 100, 30),
    mkSub("u1", "P2", 100, 130),
  ];
  findForContestScoreboardByContestId.mockResolvedValue(submissions);
  findForContestChartByContestId.mockResolvedValue(submissions);
});

describe("getScoreboardChart freeze cutoff", () => {
  it("hides post-freeze submissions from the chart for non-privileged viewers", async () => {
    const chart = await getScoreboardChart("contest-1", 10);

    const u1 = chart.series.find((s) => s.userId === "u1");
    expect(u1).toBeDefined();
    expect(u1?.points).toEqual([
      { score: 0, time: 0 },
      { score: 100, time: 30 * 60 },
    ]);
  });

  it("shows post-freeze submissions when the viewer can see the live scoreboard", async () => {
    const chart = await getScoreboardChart("contest-1", 10, { canSeeLive: true });

    const u1 = chart.series.find((s) => s.userId === "u1");
    expect(u1?.points).toEqual([
      { score: 0, time: 0 },
      { score: 100, time: 30 * 60 },
      { score: 200, time: 130 * 60 },
    ]);
  });
});

describe("scoreboard cache lock ownership", () => {
  it("does not release a successor lock after the original lease expires", async () => {
    let owner: string | undefined;
    redis.set.mockImplementation(async (key: string, value: string) => {
      if (key.startsWith("sb-lock:")) owner = value;
      return "OK";
    });
    redis.del.mockImplementation(async () => {
      owner = undefined;
      return 1;
    });
    redis.eval.mockImplementation(
      async (_script: string, _count: number, _key: string, token: string) => {
        if (owner !== token) return 0;
        owner = undefined;
        return 1;
      },
    );
    let finishFirst!: (value: []) => void;
    let finishSecond!: (value: []) => void;
    findContestScoreboardParticipants
      .mockImplementationOnce(
        () =>
          new Promise<[]>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<[]>((resolve) => {
            finishSecond = resolve;
          }),
      );
    const a = contestDomain.getScoreboard("contest-1");
    await vi.waitFor(() => expect(finishFirst).toBeDefined());
    const original = owner;
    owner = undefined;
    const b = contestDomain.getScoreboard("contest-1");
    await vi.waitFor(() => expect(finishSecond).toBeDefined());
    const successor = owner;
    finishFirst([]);
    await a;
    const ownerAfterFirst = owner;
    finishSecond([]);
    await b;
    expect(successor).not.toBe(original);
    expect(ownerAfterFirst).toBe(successor);
    expect(owner).toBeUndefined();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
