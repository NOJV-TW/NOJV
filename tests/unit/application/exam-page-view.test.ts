import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  detail: vi.fn(),
  canSetOverride: vi.fn(),
  canAsk: vi.fn(),
  canAnswer: vi.fn(),
  canView: vi.fn(),
  report: vi.fn(),
  flags: vi.fn(),
  ipViolations: vi.fn(),
  activeSessions: vi.fn(),
  feedback: vi.fn(),
  audit: vi.fn(),
  sessionState: vi.fn(),
  submitted: vi.fn(),
  recent: vi.fn(),
  credentials: vi.fn(),
  picker: vi.fn(),
  matrix: vi.fn(),
}));

vi.mock("../../../packages/application/src/exam/detail", () => ({
  getExamDetailPage: m.detail,
}));
vi.mock("../../../packages/application/src/score-override/permissions", () => ({
  canSetScoreOverride: m.canSetOverride,
}));
vi.mock("../../../packages/application/src/clarification/permissions", () => ({
  canAskClarification: m.canAsk,
  canAnswerInContext: m.canAnswer,
  canViewClarifications: m.canView,
}));
vi.mock("../../../packages/application/src/plagiarism/queries", () => ({
  findPlagiarismReport: m.report,
}));
vi.mock("../../../packages/application/src/plagiarism/flags", () => ({
  listFlagsForContext: m.flags,
}));
vi.mock("../../../packages/application/src/exam/queries", () => ({
  listExamIpViolations: m.ipViolations,
}));
vi.mock("../../../packages/application/src/exam/session", () => ({
  listActiveSessions: m.activeSessions,
  getSessionState: m.sessionState,
  listSubmittedProblemIds: m.submitted,
}));
vi.mock("../../../packages/application/src/feedback/queries", () => ({
  getFeedbackForStudent: m.feedback,
}));
vi.mock("../../../packages/application/src/audit/queries", () => ({
  getAuditTimelineView: m.audit,
}));
vi.mock("../../../packages/application/src/submission/history", () => ({
  listRecentContextSubmissions: m.recent,
}));
vi.mock("../../../packages/application/src/exam/credentials", () => ({ list: m.credentials }));
vi.mock("../../../packages/application/src/course/problem-library", () => ({
  listCourseProblemPickerGroups: m.picker,
}));
vi.mock("../../../packages/application/src/exam/submissions-matrix", () => ({
  buildExamSubmissionsMatrix: m.matrix,
}));

const { getExamPageView } = await import("../../../packages/application/src/exam/page-view");

const actor = {
  userId: "u1",
  username: "u1",
  displayName: "U1",
  email: "u1@example.com",
  platformRole: "teacher" as const,
};

const detail = {
  courseId: "c1",
  totalPoints: 100,
  endsAt: "2026-09-01T00:00:00.000Z",
  problems: [{ id: "p1", ordinal: 1, title: "A", points: 100 }],
};

beforeEach(() => {
  vi.resetAllMocks();
  m.detail.mockResolvedValue(detail);
  m.canSetOverride.mockResolvedValue(true);
  m.canAsk.mockResolvedValue(false);
  m.canAnswer.mockResolvedValue(true);
  m.canView.mockResolvedValue(true);
  m.report.mockResolvedValue({ status: "completed" });
  m.flags.mockResolvedValue([{ id: "f1" }]);
  m.ipViolations.mockResolvedValue([
    {
      id: "v1",
      userId: "s1",
      user: { displayUsername: null, email: "s1@example.com", name: "S1" },
      violationType: "ip_mismatch",
      expectedIp: "1.1.1.1",
      actualIp: "2.2.2.2",
      createdAt: new Date("2026-09-01T01:00:00.000Z"),
    },
  ]);
  m.activeSessions.mockResolvedValue([{ userId: "s1" }]);
  m.audit.mockResolvedValue({
    auditEvents: [{ kind: "lifecycle", actorUserId: "u1" }],
    auditActorNames: { u1: "U1" },
  });
  m.recent.mockResolvedValue([{ id: "sub1" }]);
  m.credentials.mockResolvedValue([{ userId: "s1" }]);
  m.picker.mockResolvedValue({ personalProblems: [{ id: "p2" }], publicProblems: [] });
  m.matrix.mockResolvedValue({ problems: [], rows: [] });
  m.feedback.mockResolvedValue([{ problemId: "p1", comment: "Nice", extra: 1 }]);
  m.sessionState.mockResolvedValue({ hasActiveSession: true, hasSubmitted: false });
  m.submitted.mockResolvedValue(["p1"]);
});

describe("getExamPageView", () => {
  it("assembles the manager view without student-only reads", async () => {
    const view = await getExamPageView(actor, { examId: "e1", isManager: true });

    expect(view).toMatchObject({
      detail,
      hasActiveSession: false,
      hasSubmitted: false,
      submittedProblemIds: [],
      matrix: { problems: [], rows: [] },
      activeSessions: [{ userId: "s1" }],
      canSetOverride: true,
      clarification: { canAsk: false, canAnswer: true, canView: true },
      plagiarism: { status: "completed" },
      plagiarismFlags: [{ id: "f1" }],
      ipViolations: [
        {
          id: "v1",
          userId: "s1",
          handle: "s1@example.com",
          displayName: "S1",
          violationType: "ip_mismatch",
          expectedIp: "1.1.1.1",
          actualIp: "2.2.2.2",
          createdAt: "2026-09-01T01:00:00.000Z",
        },
      ],
      feedback: [],
      auditEvents: [{ kind: "lifecycle", actorUserId: "u1" }],
      auditActorNames: { u1: "U1" },
      candidateProblems: { personalProblems: [{ id: "p2" }], publicProblems: [] },
      recentSubmissions: [{ id: "sub1" }],
      examCredentials: [{ userId: "s1" }],
    });
    expect(m.audit).toHaveBeenCalledWith({ type: "exam", examId: "e1" });
    expect(m.picker).toHaveBeenCalledWith(actor, "c1", ["p1"]);
    expect(m.matrix).toHaveBeenCalledWith({
      examId: "e1",
      courseId: "c1",
      totalPoints: 100,
      endsAt: new Date(detail.endsAt),
      problems: [{ problemId: "p1", ordinal: 1, title: "A", points: 100 }],
    });
    expect(m.feedback).not.toHaveBeenCalled();
    expect(m.sessionState).not.toHaveBeenCalled();
    expect(m.submitted).not.toHaveBeenCalled();
  });

  it("assembles the student view without manager-only reads", async () => {
    const view = await getExamPageView(actor, { examId: "e1", isManager: false });

    expect(view).toEqual({
      detail,
      hasActiveSession: true,
      hasSubmitted: false,
      submittedProblemIds: ["p1"],
      matrix: null,
      activeSessions: [],
      canSetOverride: false,
      clarification: { canAsk: false, canAnswer: true, canView: true },
      plagiarism: null,
      plagiarismFlags: [],
      ipViolations: [],
      feedback: [{ problemId: "p1", comment: "Nice" }],
      auditEvents: [],
      auditActorNames: {},
      candidateProblems: { personalProblems: [], publicProblems: [] },
      recentSubmissions: [],
      examCredentials: [],
    });
    for (const managerOnly of [
      m.canSetOverride,
      m.report,
      m.flags,
      m.ipViolations,
      m.activeSessions,
      m.audit,
      m.recent,
      m.credentials,
      m.picker,
      m.matrix,
    ]) {
      expect(managerOnly).not.toHaveBeenCalled();
    }
  });

  it("skips detail-dependent reads when the exam is hidden", async () => {
    m.detail.mockResolvedValue(null);
    const view = await getExamPageView(actor, { examId: "e1", isManager: true });
    expect(view.detail).toBeNull();
    expect(view.matrix).toBeNull();
    expect(m.picker).not.toHaveBeenCalled();
    expect(m.matrix).not.toHaveBeenCalled();
  });
});
