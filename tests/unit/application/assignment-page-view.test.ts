import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  detail: vi.fn(),
  matrix: vi.fn(),
  report: vi.fn(),
  flags: vi.fn(),
  canSetOverride: vi.fn(),
  canAsk: vi.fn(),
  canAnswer: vi.fn(),
  canView: vi.fn(),
  audit: vi.fn(),
  recent: vi.fn(),
  picker: vi.fn(),
  feedback: vi.fn(),
}));

vi.mock("../../../packages/application/src/course/assignment-detail", () => ({
  getAssignmentDetail: m.detail,
}));
vi.mock("../../../packages/application/src/course/submissions-matrix", () => ({
  buildSubmissionsMatrix: m.matrix,
}));
vi.mock("../../../packages/application/src/course/problem-library", () => ({
  listCourseProblemPickerGroups: m.picker,
}));
vi.mock("../../../packages/application/src/plagiarism/queries", () => ({
  findPlagiarismReport: m.report,
}));
vi.mock("../../../packages/application/src/plagiarism/flags", () => ({
  listFlagsForContext: m.flags,
}));
vi.mock("../../../packages/application/src/score-override/permissions", () => ({
  canSetScoreOverride: m.canSetOverride,
}));
vi.mock("../../../packages/application/src/clarification/permissions", () => ({
  canAskClarification: m.canAsk,
  canAnswerInContext: m.canAnswer,
  canViewClarifications: m.canView,
}));
vi.mock("../../../packages/application/src/audit/queries", () => ({
  getAuditTimelineView: m.audit,
}));
vi.mock("../../../packages/application/src/submission/history", () => ({
  listRecentContextSubmissions: m.recent,
}));
vi.mock("../../../packages/application/src/feedback/queries", () => ({
  getFeedbackForStudent: m.feedback,
}));

const { getAssignmentPageView } =
  await import("../../../packages/application/src/assignment/page-view");

const actor = {
  userId: "u1",
  username: "u1",
  displayName: "U1",
  email: "u1@example.com",
  platformRole: "student" as const,
};
const options = { courseId: "c1", assignmentId: "a1" };
const context = { type: "assignment", assignmentId: "a1" };

beforeEach(() => {
  vi.resetAllMocks();
  m.detail.mockResolvedValue({ problems: [{ problemId: "p1" }, { problemId: "p2" }] });
  m.matrix.mockResolvedValue({ rows: [] });
  m.report.mockResolvedValue(null);
  m.flags.mockResolvedValue([]);
  m.canSetOverride.mockResolvedValue(true);
  m.canAsk.mockResolvedValue(true);
  m.canAnswer.mockResolvedValue(false);
  m.canView.mockResolvedValue(true);
  m.audit.mockResolvedValue({ auditEvents: [], auditActorNames: {} });
  m.recent.mockResolvedValue([]);
  m.picker.mockResolvedValue({ personalProblems: [], publicProblems: [] });
  m.feedback.mockResolvedValue([{ problemId: "p1", comment: "Good", id: "f1" }]);
});

describe("getAssignmentPageView", () => {
  it("assembles the teacher view", async () => {
    const view = await getAssignmentPageView(actor, { ...options, isManager: true });

    expect(view).toEqual({
      mode: "teacher",
      detail: { problems: [{ problemId: "p1" }, { problemId: "p2" }] },
      matrix: { rows: [] },
      candidateProblems: { personalProblems: [], publicProblems: [] },
      canSetOverride: true,
      clarification: { canAsk: true, canAnswer: false, canView: true },
      plagiarism: null,
      plagiarismFlags: [],
      auditEvents: [],
      auditActorNames: {},
      recentSubmissions: [],
    });
    expect(m.detail).toHaveBeenCalledWith("c1", "a1", { viewerUserId: "u1", isManager: true });
    expect(m.report).toHaveBeenCalledWith({ type: "assessment", id: "a1" });
    expect(m.canSetOverride).toHaveBeenCalledWith(actor, context);
    expect(m.audit).toHaveBeenCalledWith(context);
    expect(m.recent).toHaveBeenCalledWith({
      actor,
      context: { type: "assignment", id: "a1" },
    });
    expect(m.picker).toHaveBeenCalledWith(actor, "c1", ["p1", "p2"]);
    expect(m.feedback).not.toHaveBeenCalled();
  });

  it("assembles the student view without teacher reads", async () => {
    const view = await getAssignmentPageView(actor, { ...options, isManager: false });

    expect(view).toEqual({
      mode: "student",
      detail: { problems: [{ problemId: "p1" }, { problemId: "p2" }] },
      clarification: { canAsk: true, canAnswer: false, canView: true },
      feedback: [{ problemId: "p1", comment: "Good" }],
    });
    expect(m.detail).toHaveBeenCalledWith("c1", "a1", { viewerUserId: "u1", isManager: false });
    expect(m.feedback).toHaveBeenCalledWith("u1", context);
    for (const teacherOnly of [
      m.matrix,
      m.report,
      m.flags,
      m.canSetOverride,
      m.audit,
      m.recent,
      m.picker,
    ]) {
      expect(teacherOnly).not.toHaveBeenCalled();
    }
  });
});
