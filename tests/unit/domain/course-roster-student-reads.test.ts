import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMembership, findStudents, findOverrides, grouped, assignmentDetail, examDetail } =
  vi.hoisted(() => ({
    findMembership: vi.fn(),
    findStudents: vi.fn(),
    findOverrides: vi.fn(),
    grouped: vi.fn(),
    assignmentDetail: vi.fn(),
    examDetail: vi.fn(),
  }));

vi.mock("@nojv/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nojv/db")>()),
  gradingRepo: { countPendingExam: vi.fn().mockResolvedValue(0) },
  courseMembershipRepo: { findByComposite: findMembership, findStudents },
  scoreOverrideRepo: { findAllByContext: findOverrides },
  submissionRepo: {
    groupByUserAndProblem: grouped,
    findMany: vi.fn(() => Promise.resolve([])),
  },
  assessmentRepo: { findDetailById: assignmentDetail },
  assessmentAuditLogRepo: { listByAssessment: vi.fn(() => Promise.resolve([])) },
  examRepo: { findDetailForRegistrationPage: examDetail },
  problemRepo: {
    findScoringInputsByIds: vi.fn(() =>
      Promise.resolve([
        {
          id: "p1",
          type: "full_source",
          advancedConfig: null,
          testcaseSets: [{ weight: 100 }],
        },
      ]),
    ),
  },
}));

import { contestDomain, courseDomain, examDomain } from "@nojv/application";

beforeEach(() => {
  vi.clearAllMocks();
  const membership = {
    id: "mem_linked",
    userId: "real_user",
    pendingUsername: null,
    role: "student",
    status: "active",
    user: { id: "real_user", name: "Student", username: "student" },
  };
  findMembership.mockResolvedValue(membership);
  findStudents.mockResolvedValue([membership]);
  findOverrides.mockResolvedValue([
    { courseMembershipId: "mem_linked", userId: null, problemId: "p1", overrideScore: 90 },
    { courseMembershipId: "mem_other", userId: null, problemId: "p1", overrideScore: 20 },
  ]);
  grouped.mockResolvedValue([]);
  const problems = [
    {
      ordinal: 1,
      points: 100,
      problem: { id: "p1", displayId: 1, title: "Problem", difficulty: "easy" },
    },
  ];
  assignmentDetail.mockResolvedValue({
    id: "a1",
    courseId: "c1",
    title: "HW",
    summary: "",
    status: "published",
    opensAt: new Date("2020-01-01"),
    closesAt: new Date("2020-01-02"),
    problems,
    adjustmentRules: [],
  });
  examDetail.mockResolvedValue({
    id: "e1",
    courseId: "c1",
    title: "Exam",
    summary: "",
    status: "published",
    startsAt: new Date("2020-01-01"),
    endsAt: new Date("2020-01-02"),
    course: { archived: false },
    scoringMode: "point_sum",
    problems,
    ipWhitelist: [],
    _count: { participations: 0 },
  });
});

describe("student grade ownership after roster linking", () => {
  it("resolves assignment overrides through the authenticated user's membership", async () => {
    const detail = await courseDomain.getAssignmentDetail("c1", "a1", {
      viewerUserId: "real_user",
      isManager: false,
    });
    expect(findMembership).toHaveBeenCalledWith("c1", "real_user");
    expect(detail.problems[0].myStatus).toMatchObject({
      bestScore: 90,
      overridden: true,
      attempts: 0,
    });
    expect(grouped).toHaveBeenCalledWith(expect.objectContaining({ userId: "real_user" }));
  });

  it("does not treat an account id as a membership id when no enrollment exists", async () => {
    findMembership.mockResolvedValue(null);
    const detail = await courseDomain.getAssignmentDetail("c1", "a1", {
      viewerUserId: "mem_linked",
      isManager: false,
    });
    expect(detail.problems[0].myStatus).toMatchObject({ bestScore: null, overridden: false });
  });

  it("shows a linked student's manual exam grade without requiring participation", async () => {
    const detail = await examDomain.getExamDetailPage("e1", {
      viewerUserId: "real_user",
      isManager: false,
    });
    expect(detail).toMatchObject({ viewerScore: 90, registeredCount: 0, totalStudents: 1 });
    expect(detail?.problems[0].viewerState).toBe("partial");
    expect(grouped).toHaveBeenCalledWith(expect.objectContaining({ userId: "real_user" }));
  });

  it("does not expose a manual exam grade to a different authenticated account", async () => {
    const detail = await examDomain.getExamDetailPage("e1", {
      viewerUserId: "mem_linked",
      isManager: false,
    });
    expect(detail?.viewerScore).toBe(0);
  });

  it("keeps contest rows and overrides keyed by real user id", async () => {
    findOverrides.mockResolvedValue([
      { userId: "real_user", courseMembershipId: null, problemId: "p1", overrideScore: 75 },
    ]);
    const matrix = await contestDomain.buildContestSubmissionsMatrix({
      contestId: "contest_1",
      problems: [{ id: "p1", ordinal: 1, points: 100, title: "Problem" }],
      participants: [
        {
          userId: "real_user",
          user: { id: "real_user", name: "Student", username: "student" },
        },
      ],
    });
    expect(matrix.rows[0]).toMatchObject({
      rowId: "real_user",
      courseMembershipId: null,
      userId: "real_user",
      total: 75,
    });
  });
});
