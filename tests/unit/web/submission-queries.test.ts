import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findByIdForUserRead,
  listAllPaged,
  listByUser,
  countAll,
  countByUser,
  listHistoryPage,
  queuedRejudges,
} = vi.hoisted(() => ({
  listHistoryPage: vi.fn(),
  queuedRejudges: vi.fn<() => Promise<unknown[]>>(async () => []),
  findByIdForUserRead: vi.fn(),
  listAllPaged: vi.fn(),
  listByUser: vi.fn(),
  countAll: vi.fn(),
  countByUser: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  durableWorkRepo: { listQueuedRejudges: queuedRejudges },
  submissionRepo: {
    findById: vi.fn().mockResolvedValue(null),
    findByIdForUserRead,
    listHistoryPage,
    listAllPaged,
    listByUser,
    countAll,
    countByUser,
  },
  assessmentRepo: {
    findByCourseAndId: vi.fn(),
  },
  problemRepo: {
    findById: vi.fn(),
  },
}));

import { NotFoundError, submissionDomain } from "@nojv/application";

const { getSubmissionForActor } = submissionDomain;

const actor = {
  userId: "user_alice",
  username: "alice",
  email: "alice@example.test",
  displayName: "Alice",
  platformRole: "student" as const,
};

describe("getSubmissionForActor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns submission when user owns it", async () => {
    const submission = { id: "sub_1", userId: "user_alice", verdict: "accepted" };
    findByIdForUserRead.mockResolvedValue(submission);

    const result = await getSubmissionForActor(actor, "sub_1");

    expect(result).toEqual(submission);
    expect(findByIdForUserRead).toHaveBeenCalledWith({
      id: "sub_1",
      userId: "user_alice",
      adminRecovery: false,
    });
  });

  it("returns submission when user is admin even if not owner", async () => {
    const submission = { id: "sub_1", userId: "user_bob", verdict: "accepted" };
    findByIdForUserRead.mockResolvedValue(submission);

    const result = await getSubmissionForActor({ ...actor, platformRole: "admin" }, "sub_1");

    expect(result).toEqual(submission);
    expect(findByIdForUserRead).toHaveBeenCalledWith({
      id: "sub_1",
      userId: "user_alice",
      adminRecovery: true,
    });
  });

  it("throws NotFoundError when submission doesn't exist", async () => {
    findByIdForUserRead.mockResolvedValue(null);

    await expect(getSubmissionForActor(actor, "sub_missing")).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when user doesn't own it and is not admin", async () => {
    findByIdForUserRead.mockResolvedValue(null);

    await expect(getSubmissionForActor(actor, "sub_1")).rejects.toThrow(NotFoundError);
  });
});

describe("listUserSubmissions", () => {
  it.each(["admin", "student"] as const)(
    "returns submitter identity only for %s access",
    async (platformRole) => {
      const user = { name: "Alice", username: "alice" };
      const submission = {
        id: "sub_1",
        createdAt: new Date("2026-09-07T00:00:00Z"),
        updatedAt: new Date("2026-09-07T00:00:00Z"),
        judgeGeneration: 1,
        language: "cpp",
        score: 100,
        status: "accepted",
        problem: {
          id: "p1",
          title: "A + B",
          type: "standard",
          testcaseSets: [{ weight: 100 }],
          advancedConfig: null,
        },
        user,
      };
      listHistoryPage.mockResolvedValue({
        rows: [submission],
        totalCount: 1,
        newCount: 0,
        snapshot: { id: submission.id, createdAt: submission.createdAt },
      });
      listAllPaged.mockResolvedValue([submission]);
      listByUser.mockResolvedValue([submission]);
      countAll.mockResolvedValue(1);
      countByUser.mockResolvedValue(1);

      const page = await submissionDomain.listUserSubmissions({
        actor: { ...actor, platformRole },
        limit: 50,
      });

      expect(page.items[0]?.user).toEqual(platformRole === "admin" ? user : null);
    },
  );
});

describe("listWorkspaceSubmissions", () => {
  it.each([
    [{ type: "practice" }, {}],
    [{ type: "exam", examId: "exam_1" }, { examId: "exam_1" }],
    [
      { type: "assignment", assessmentId: "assignment_1", courseId: "course_1" },
      { assessmentId: "assignment_1" },
    ],
    [{ type: "contest", contestId: "contest_1" }, { contestId: "contest_1" }],
    [{ type: "virtual", participationId: "virtual_1" }, { participationId: "virtual_1" }],
  ] as const)(
    "keeps owner, problem, confinement and context %j on older pages",
    async (context, scope) => {
      listByUser.mockResolvedValue([]);
      await submissionDomain.listWorkspaceSubmissions({
        actor,
        problemId: "problem_a",
        context,
        cursor: "older",
      });
      expect(listByUser).toHaveBeenLastCalledWith({
        userId: actor.userId,
        enforceExamConfinement: true,
        problemId: "problem_a",
        limit: 50,
        cursor: "older",
        ...scope,
      });
    },
  );

  it("returns successive history pages without a total count cap", async () => {
    const rows = Array.from({ length: 151 }, (_, i) => ({
      id: `submission_${i}`,
      createdAt: new Date(1800000000000 - i),
      updatedAt: new Date(1800000000000 - i),
      judgeGeneration: 1,
      language: "python",
      status: "accepted",
      score: 100,
      runtimeMs: 1,
      verdictSummary: null,
      contestId: null,
      assessmentId: null,
      examId: "exam_1",
    }));
    listByUser.mockImplementation(({ cursor, limit }) => {
      const offset = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
      return Promise.resolve(rows.slice(offset, offset + limit + 1));
    });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await submissionDomain.listWorkspaceSubmissions({
        actor,
        problemId: "problem_a",
        context: { type: "exam", examId: "exam_1" },
        ...(cursor ? { cursor } : {}),
      });
      ids.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(rows.map((row) => row.id));
  });

  it("rejects a cursor outside the allowed history scope", async () => {
    listByUser.mockResolvedValue(null);
    await expect(
      submissionDomain.listWorkspaceSubmissions({
        actor,
        problemId: "problem_a",
        context: { type: "exam", examId: "exam_1" },
        cursor: "another_problem",
      }),
    ).rejects.toThrow("Invalid submission cursor");
  });
});

describe("numbered submission history snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listHistoryPage.mockResolvedValue({
      rows: [],
      totalCount: 151,
      newCount: 0,
      snapshot: { id: "anchor", createdAt: new Date("2026-09-07T00:00:00Z") },
    });
  });

  it("keeps the same authorized bound on later pages and reports new arrivals", async () => {
    const first = await submissionDomain.listUserSubmissions({ actor, limit: 50 });
    listHistoryPage.mockResolvedValueOnce({
      rows: [],
      totalCount: 151,
      newCount: 2,
      snapshot: { id: "anchor", createdAt: new Date("2026-09-07T00:00:00Z") },
    });
    const fourth = await submissionDomain.listUserSubmissions({
      actor,
      limit: 50,
      page: 4,
      snapshot: first.snapshot,
    });
    expect(listHistoryPage).toHaveBeenLastCalledWith({
      userId: actor.userId,
      filters: {},
      queuedRejudgeIds: [],
      page: 4,
      limit: 50,
      snapshot: { id: "anchor", createdAt: new Date("2026-09-07T00:00:00Z") },
    });
    expect(fourth).toMatchObject({
      totalCount: 151,
      totalPages: 4,
      page: 4,
      newCount: 2,
      snapshot: first.snapshot,
    });
  });

  it("rejects snapshots after actor or filters change", async () => {
    const first = await submissionDomain.listUserSubmissions({ actor, limit: 50 });
    await expect(
      submissionDomain.listUserSubmissions({
        actor: { ...actor, userId: "other" },
        limit: 50,
        snapshot: first.snapshot,
      }),
    ).rejects.toThrow("Invalid submission snapshot");
    await expect(
      submissionDomain.listUserSubmissions({
        actor,
        limit: 50,
        snapshot: first.snapshot,
        filters: { status: "accepted" },
      }),
    ).rejects.toThrow("Invalid submission snapshot");
  });

  it("rejects inaccessible anchors without exposing whether they exist", async () => {
    const first = await submissionDomain.listUserSubmissions({ actor, limit: 50 });
    listHistoryPage.mockResolvedValueOnce(null);
    await expect(
      submissionDomain.listUserSubmissions({ actor, limit: 50, snapshot: first.snapshot }),
    ).rejects.toThrow("Invalid submission snapshot");
  });
  it("passes authoritative queued rejudges into filtering and hides retained results", async () => {
    queuedRejudges.mockResolvedValueOnce([
      {
        status: "pending",
        submissionId: "accepted-before",
        submissionGeneration: 1,
        submissionUpdatedAt: new Date("2026-09-07T00:00:00Z"),
        attempt: 0,
        updatedAt: new Date("2026-09-08T00:00:00Z"),
        payload: {
          workflowId: "rejudge-one",
          input: {
            mode: "single",
            submissionId: "accepted-before",
            triggeredByUserId: "staff",
          },
        },
      },
    ]);
    listHistoryPage.mockResolvedValueOnce({
      rows: [
        {
          id: "accepted-before",
          status: "accepted",
          updatedAt: new Date("2026-09-07T00:00:00Z"),
          judgeGeneration: 1,
          score: 100,
          runtimeMs: 10,
          memoryKb: 5,
          createdAt: new Date("2026-09-07T00:00:00Z"),
          language: "python",
          problem: {
            id: "p",
            title: "A",
            type: "standard",
            testcaseSets: [{ weight: 100 }],
            advancedConfig: null,
          },
        },
      ],
      totalCount: 1,
      newCount: 0,
      snapshot: { id: "accepted-before", createdAt: new Date("2026-09-07T00:00:00Z") },
    });
    const result = await submissionDomain.listUserSubmissions({
      actor,
      limit: 50,
      filters: { status: "queued" },
    });
    expect(listHistoryPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queuedRejudgeIds: ["accepted-before"],
        filters: { status: "queued" },
      }),
    );
    expect(result.items[0]).toMatchObject({
      status: "queued",
      score: null,
      runtimeMs: null,
      memoryKb: null,
    });
  });

  it("does not show retained accepted scores or resources after rejudge system error", async () => {
    listHistoryPage.mockResolvedValueOnce({
      rows: [
        {
          id: "failed",
          status: "system_error",
          updatedAt: new Date("2026-09-07T00:00:00Z"),
          judgeGeneration: 2,
          score: 100,
          runtimeMs: 10,
          memoryKb: 5,
          createdAt: new Date("2026-09-07T00:00:00Z"),
          language: "python",
          problem: {
            id: "p",
            title: "A",
            type: "standard",
            testcaseSets: [{ weight: 100 }],
            advancedConfig: null,
          },
        },
      ],
      totalCount: 1,
      newCount: 0,
      snapshot: { id: "failed", createdAt: new Date("2026-09-07T00:00:00Z") },
    });
    const result = await submissionDomain.listUserSubmissions({ actor, limit: 50 });
    expect(result.items[0]).toMatchObject({
      status: "system_error",
      score: 0,
      runtimeMs: 0,
      memoryKb: null,
    });
  });
});
