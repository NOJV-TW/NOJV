import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findForScoreboardById,
  findInfoById,
  findForContestScoreboardByContestId,
  findForContestChartByContestId,
  findContestScoreboardParticipants,
} = vi.hoisted(() => ({
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
  scoreboard: {},
}));

import { contestDomain } from "@nojv/domain";

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
  vi.clearAllMocks();

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
    scoringMode: "problem_count",
    startsAt: START,
    visibility: "public",
  });

  findInfoById.mockResolvedValue({
    endsAt: END,
    frozenAt: FROZEN_AT,
    scoringMode: "problem_count",
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
