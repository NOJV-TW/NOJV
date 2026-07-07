import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  problemFindById,
  submissionListByUserAndProblem,
  submissionFindMany,
  submissionGroupByUserAndProblem,
  examFindDetailById,
  storageGetVerdictDetail,
  getProblemPageData,
  testcaseSetFindByProblemId,
  findScoringInputsByIds,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  submissionListByUserAndProblem: vi.fn(),
  submissionFindMany: vi.fn(),
  submissionGroupByUserAndProblem: vi.fn(),
  examFindDetailById: vi.fn(),
  storageGetVerdictDetail: vi.fn(),
  getProblemPageData: vi.fn(),
  testcaseSetFindByProblemId: vi.fn(),
  findScoringInputsByIds: vi.fn((ids: string[]) =>
    Promise.resolve(
      ids.map((id) => ({
        id,
        type: "full_source",
        advancedConfig: null,
        testcaseSets: [{ weight: 100 }],
      })),
    ),
  ),
}));

vi.mock("@nojv/db", () => ({
  Prisma: {},
  assessmentRepo: { findByCourseAndId: vi.fn() },
  problemRepo: { findById: problemFindById, findScoringInputsByIds },
  submissionRepo: {
    listByUserAndProblem: submissionListByUserAndProblem,
    findMany: submissionFindMany,
    groupByUserAndProblem: submissionGroupByUserAndProblem,
  },
  examRepo: { findDetailById: examFindDetailById },
  testcaseSetRepo: { findByProblemId: testcaseSetFindByProblemId },
  contestRepo: { findDetailById: vi.fn() },
  participationRepo: {
    findVirtual: vi.fn(),
    findVirtualById: vi.fn(),
  },
}));

vi.mock("@nojv/storage", () => ({
  createStorageClient: vi.fn(() => ({})),
  getSubmissionSources: vi.fn(),
  getVerdictDetail: storageGetVerdictDetail,
  putText: vi.fn(),
  getText: vi.fn(),
  deleteBlob: vi.fn(),
  deleteBlobsByPrefix: vi.fn(),
  putVerdictDetail: vi.fn(),
  testcaseInputKey: vi.fn(),
  testcaseOutputKey: vi.fn(),
  testcaseInputFileKey: vi.fn(),
  workspaceFileKey: vi.fn(),
  problemPrefix: vi.fn(),
  submissionPrefix: vi.fn(),
  submissionVerdictDetailKey: vi.fn(),
  checkerKey: vi.fn(),
  interactorKey: vi.fn(),
}));

vi.mock("../../../packages/application/src/problem/queries", async () => {
  const actual: typeof import("../../../packages/application/src/problem/queries") =
    await vi.importActual("../../../packages/application/src/problem/queries");
  return {
    ...actual,
    getProblemPageData,
  };
});

import { submissionDomain, examDomain, virtualContestDomain } from "@nojv/application";

const { listProblemSubmissions } = submissionDomain;
const { getExamProblemView, getExamProblemViewByProblemId } = examDomain;
const { listVirtualContestProblemSubmissions } = virtualContestDomain;

function row(overrides: Partial<{ id: string; status: string; score: number }> = {}) {
  const status = overrides.status ?? "wrong_answer";
  return {
    id: overrides.id ?? "sub_1",
    createdAt: new Date("2026-05-29T00:00:00Z"),
    language: "cpp",
    status,
    score: overrides.score ?? (status === "accepted" ? 100 : 0),
    verdictDetailStorageKey: "submissions/sub_1/verdict-detail.json",
    contestId: null,
    assessmentId: null,
    examId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listProblemSubmissions — verdict-detail blob fallback", () => {
  beforeEach(() => {
    problemFindById.mockResolvedValue({ id: "prob_1" });
    submissionListByUserAndProblem.mockResolvedValue([row()]);
  });

  it("does not throw when the blob is missing (storage returns null)", async () => {
    storageGetVerdictDetail.mockResolvedValue(null);

    const result = await listProblemSubmissions("usr_1", "prob_1");

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("sub_1");
    expect(result[0]!.result.verdict).toBe("wrong_answer");
    expect(result[0]!.result.feedback).toBe("Verdict details unavailable.");
    expect(result[0]!.result.score).toBe(0);
  });

  it("does not throw when the blob is schema-invalid; fallback derives verdict from row.status", async () => {
    storageGetVerdictDetail.mockResolvedValue({ totally: "not a SubmissionResult" });

    const result = await listProblemSubmissions("usr_1", "prob_1");

    expect(result).toHaveLength(1);
    expect(result[0]!.result.verdict).toBe("wrong_answer");
    expect(result[0]!.result.accepted).toBe(false);
  });

  it("preserves a row-status of 'accepted' (and score 100) in the synthesized fallback", async () => {
    submissionListByUserAndProblem.mockResolvedValue([
      row({ id: "sub_ok", status: "accepted" }),
    ]);
    storageGetVerdictDetail.mockResolvedValue(null);

    const result = await listProblemSubmissions("usr_1", "prob_1");

    expect(result[0]!.result.verdict).toBe("accepted");
    expect(result[0]!.result.accepted).toBe(true);
    expect(result[0]!.result.score).toBe(100);
  });
});

describe("getExamProblemView — verdict-detail blob fallback", () => {
  const examFixture = {
    id: "exam_1",
    courseId: "crs_1",
    title: "Midterm",
    startsAt: new Date("2026-05-01T00:00:00Z"),
    endsAt: new Date("2026-05-01T03:00:00Z"),
    status: "published",
    course: { title: "Algorithms" },
    problems: [{ problem: { id: "prob_1", title: "P1" }, points: 100 }],
  };

  beforeEach(() => {
    examFindDetailById.mockResolvedValue(examFixture);
    submissionFindMany.mockResolvedValue([row()]);
    submissionGroupByUserAndProblem.mockResolvedValue([]);
    getProblemPageData.mockResolvedValue({ id: "prob_1", title: "P1", type: "full_source" });
    testcaseSetFindByProblemId.mockResolvedValue([]);
  });

  it("does not throw when the blob is missing", async () => {
    storageGetVerdictDetail.mockResolvedValue(null);

    const view = await getExamProblemView({
      examId: "exam_1",
      problemIdx: 0,
      actorUserId: "usr_1",
    });

    expect(view).not.toBeNull();
    expect(view!.submissions).toHaveLength(1);
    expect(view!.submissions[0]!.result.verdict).toBe("wrong_answer");
    expect(view!.submissions[0]!.result.feedback).toBe("Verdict details unavailable.");
  });

  it("does not throw when the blob is schema-invalid (getExamProblemViewByProblemId)", async () => {
    storageGetVerdictDetail.mockResolvedValue("not even an object");

    const view = await getExamProblemViewByProblemId({
      examId: "exam_1",
      problemId: "prob_1",
      actorUserId: "usr_1",
    });

    expect(view).not.toBeNull();
    expect(view!.submissions).toHaveLength(1);
    expect(view!.submissions[0]!.result.verdict).toBe("wrong_answer");
  });

  it("accepted submission score comes from the DB row, not synthesized from subtask weights", async () => {
    submissionFindMany.mockResolvedValue([row({ id: "sub_ok", status: "accepted" })]);
    testcaseSetFindByProblemId.mockResolvedValue([{ weight: 80 }, { weight: 120 }]);
    storageGetVerdictDetail.mockResolvedValue(null);

    const view = await getExamProblemView({
      examId: "exam_1",
      problemIdx: 0,
      actorUserId: "usr_1",
    });

    expect(view!.submissions[0]!.result.verdict).toBe("accepted");
    expect(view!.submissions[0]!.result.score).toBe(100);
  });
});

describe("listVirtualContestProblemSubmissions — verdict-detail blob fallback", () => {
  beforeEach(() => {
    submissionListByUserAndProblem.mockResolvedValue([row()]);
    testcaseSetFindByProblemId.mockResolvedValue([]);
  });

  it("does not throw when the blob is missing", async () => {
    storageGetVerdictDetail.mockResolvedValue(null);

    const result = await listVirtualContestProblemSubmissions("vc_1", "usr_1", "prob_1");

    expect(result).toHaveLength(1);
    expect(result[0]!.result.verdict).toBe("wrong_answer");
    expect(result[0]!.result.feedback).toBe("Verdict details unavailable.");
  });

  it("does not throw when the blob is schema-invalid", async () => {
    storageGetVerdictDetail.mockResolvedValue({ verdict: 123, score: "nope" });

    const result = await listVirtualContestProblemSubmissions("vc_1", "usr_1", "prob_1");

    expect(result).toHaveLength(1);
    expect(result[0]!.result.verdict).toBe("wrong_answer");
  });

  it("accepted submission score comes from the DB row, not synthesized from subtask weights", async () => {
    submissionListByUserAndProblem.mockResolvedValue([
      row({ id: "sub_ok", status: "accepted" }),
    ]);
    testcaseSetFindByProblemId.mockResolvedValue([{ weight: 80 }, { weight: 120 }]);
    storageGetVerdictDetail.mockResolvedValue(null);

    const result = await listVirtualContestProblemSubmissions("vc_1", "usr_1", "prob_1");

    expect(result[0]!.result.verdict).toBe("accepted");
    expect(result[0]!.result.score).toBe(100);
  });
});
