import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  detail: vi.fn(),
  participants: vi.fn(),
  participation: vi.fn(),
  canSeeLive: vi.fn(),
  scoreboard: vi.fn(),
  matrix: vi.fn(),
  report: vi.fn(),
  flags: vi.fn(),
  audit: vi.fn(),
  picker: vi.fn(),
  recent: vi.fn(),
  canAsk: vi.fn(),
  canAnswer: vi.fn(),
  canView: vi.fn(),
}));

vi.mock("../../../packages/application/src/contest/queries", () => ({
  getContestDetail: m.detail,
  listContestParticipantsWithUser: m.participants,
  findViewerContestParticipation: m.participation,
}));
vi.mock("../../../packages/application/src/contest/permissions", () => ({
  canViewLiveContestScoreboard: m.canSeeLive,
}));
vi.mock("../../../packages/application/src/contest/scoring", () => ({
  getScoreboard: m.scoreboard,
}));
vi.mock("../../../packages/application/src/contest/submissions-matrix", () => ({
  buildContestSubmissionsMatrix: m.matrix,
}));
vi.mock("../../../packages/application/src/plagiarism/queries", () => ({
  findPlagiarismReport: m.report,
}));
vi.mock("../../../packages/application/src/plagiarism/flags", () => ({
  listFlagsForContext: m.flags,
}));
vi.mock("../../../packages/application/src/audit/queries", () => ({
  getAuditTimelineView: m.audit,
}));
vi.mock("../../../packages/application/src/problem/picker", () => ({
  listProblemPickerGroups: m.picker,
}));
vi.mock("../../../packages/application/src/submission/history", () => ({
  listRecentContextSubmissions: m.recent,
}));
vi.mock("../../../packages/application/src/clarification/permissions", () => ({
  canAskClarification: m.canAsk,
  canAnswerInContext: m.canAnswer,
  canViewClarifications: m.canView,
}));

const { getContestPageView } =
  await import("../../../packages/application/src/contest/page-view");

const now = new Date("2026-09-01T12:00:00.000Z");
const actor = {
  userId: "u1",
  username: "u1",
  displayName: "U1",
  email: "u1@example.com",
  platformRole: "teacher" as const,
};

const contest = {
  id: "c1",
  visibility: "published",
  startsAt: "2026-09-01T00:00:00.000Z",
  isManager: true,
  inviteCode: "SECRET",
  scoringMode: "point_sum",
  problems: [
    { id: "p1", points: 60 },
    { id: "p2", points: 40 },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  m.detail.mockResolvedValue(contest);
  m.canSeeLive.mockResolvedValue(true);
  m.scoreboard.mockResolvedValue({
    entries: Array.from({ length: 6 }, (_, i) => ({
      rank: i + 1,
      userId: `s${i}`,
      username: `s${i}`,
      displayName: `S${i}`,
      totalScore: 100 - i,
    })),
  });
  m.participants.mockResolvedValue([{ score: "80" }, { score: "40" }]);
  m.report.mockResolvedValue(null);
  m.flags.mockResolvedValue([]);
  m.audit.mockResolvedValue({
    auditEvents: [{ actorUserId: "u1" }],
    auditActorNames: { u1: "U1" },
  });
  m.picker.mockResolvedValue({ personalProblems: [], publicProblems: [{ id: "p3" }] });
  m.recent.mockResolvedValue([{ id: "sub1" }]);
  m.matrix.mockResolvedValue({ rows: [] });
  m.canAsk.mockResolvedValue(false);
  m.canAnswer.mockResolvedValue(true);
  m.canView.mockResolvedValue(true);
  m.participation.mockResolvedValue({ status: "joined" });
});

describe("getContestPageView", () => {
  it("assembles the manager view with results, audit and candidates", async () => {
    const view = await getContestPageView({
      contestId: "c1",
      viewer: { userId: "u1", platformRole: "teacher" },
      actor,
      now,
    });

    expect(m.detail).toHaveBeenCalledWith("c1", { userId: "u1", platformRole: "teacher", now });
    expect(m.canSeeLive).toHaveBeenCalledWith("c1", { userId: "u1", platformRole: "teacher" });
    expect(m.scoreboard).toHaveBeenCalledWith("c1", { canSeeLive: true });
    expect(view.topEntries).toHaveLength(5);
    expect(view.contest.inviteCode).toBe("SECRET");
    expect(view.results).toMatchObject({ maxScore: 100 });
    expect(view).toMatchObject({
      hasJoined: false,
      matrix: { rows: [] },
      recentSubmissions: [{ id: "sub1" }],
      candidateProblems: { personalProblems: [], publicProblems: [{ id: "p3" }] },
      clarification: { canAsk: false, canAnswer: true, canView: true },
      auditEvents: [{ actorUserId: "u1" }],
      auditActorNames: { u1: "U1" },
    });
    expect(m.participation).not.toHaveBeenCalled();
  });

  it("hides the invite code and manager data from a joined participant", async () => {
    m.detail.mockResolvedValue({ ...contest, isManager: false });
    const view = await getContestPageView({
      contestId: "c1",
      viewer: { userId: "u1", platformRole: "student" },
      actor: { ...actor, platformRole: "student" },
      now,
    });

    expect(view.contest.inviteCode).toBeNull();
    expect(view).toMatchObject({
      hasJoined: true,
      results: null,
      matrix: null,
      recentSubmissions: [],
      candidateProblems: { personalProblems: [], publicProblems: [] },
      plagiarism: null,
      plagiarismFlags: [],
      auditEvents: [],
      auditActorNames: {},
    });
    for (const managerOnly of [
      m.participants,
      m.report,
      m.flags,
      m.audit,
      m.picker,
      m.recent,
    ]) {
      expect(managerOnly).not.toHaveBeenCalled();
    }
  });

  it("serves anonymous viewers without actor-scoped reads", async () => {
    m.detail.mockResolvedValue({ ...contest, isManager: false });
    const view = await getContestPageView({
      contestId: "c1",
      viewer: { userId: null, platformRole: null },
      actor: null,
      now,
    });

    expect(m.canSeeLive).toHaveBeenCalledWith("c1", null);
    expect(view.topEntries.every((e: { isMe: boolean }) => !e.isMe)).toBe(true);
    expect(view.hasJoined).toBe(false);
    expect(view.clarification).toEqual({ canAsk: false, canAnswer: false, canView: false });
    expect(m.canAsk).not.toHaveBeenCalled();
    expect(m.participation).not.toHaveBeenCalled();
  });

  it("skips the leaderboard before the contest starts", async () => {
    const view = await getContestPageView({
      contestId: "c1",
      viewer: { userId: "u1", platformRole: "teacher" },
      actor,
      now: new Date("2026-08-31T00:00:00.000Z"),
    });
    expect(view.topEntries).toEqual([]);
    expect(m.scoreboard).not.toHaveBeenCalled();
  });
});
