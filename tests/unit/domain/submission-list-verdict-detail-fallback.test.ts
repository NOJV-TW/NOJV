/**
 * Regression for M1 from PR #73 review.
 *
 * The four "list submissions for a problem" surfaces (`listProblemSubmissions`,
 * the two exam `getExamProblemView*` variants, and `listVirtualContestProblemSubmissions`)
 * read verdict-detail blobs from object storage. A previous `schema.parse` call
 * would throw and 500 the entire list when the blob was missing or had drifted
 * from the current `submissionResultSchema` shape — a real risk during a
 * partial purge or a read-after-write window.
 *
 * The fix swaps `.parse` for `safeParse` and degrades to a synthesized
 * row-status-only `SubmissionResult` (`fallbackResultForRow`) instead of
 * throwing. The row stays in the list, the verdict is preserved from the DB
 * column, and case breakdowns are simply omitted.
 *
 * Tests assert that null and malformed blobs do NOT throw, that the row is
 * still returned, and that the synthesized result carries the row's verdict.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  problemFindById,
  submissionListByUserAndProblem,
  submissionFindMany,
  submissionGroupByUserAndProblem,
  examFindDetailById,
  storageGetVerdictDetail,
  getProblemPageData,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  submissionListByUserAndProblem: vi.fn(),
  submissionFindMany: vi.fn(),
  submissionGroupByUserAndProblem: vi.fn(),
  examFindDetailById: vi.fn(),
  storageGetVerdictDetail: vi.fn(),
  getProblemPageData: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  Prisma: {},
  assessmentRepo: { findByCourseAndId: vi.fn() },
  problemRepo: { findById: problemFindById },
  submissionRepo: {
    listByUserAndProblem: submissionListByUserAndProblem,
    findMany: submissionFindMany,
    groupByUserAndProblem: submissionGroupByUserAndProblem,
  },
  examRepo: { findDetailById: examFindDetailById },
  virtualContestRepo: { findByContestAndUser: vi.fn() },
  contestRepo: { findDetailById: vi.fn() },
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

// `getExamProblemView*` calls `problemDomain.getProblemPageData` which itself
// fans out to many repos; stubbing the helper keeps the test focused on the
// safeParse/fallback path under test.
vi.mock("../../../packages/domain/src/problem/queries", async () => {
  const actual: typeof import("../../../packages/domain/src/problem/queries") =
    await vi.importActual("../../../packages/domain/src/problem/queries");
  return {
    ...actual,
    getProblemPageData,
  };
});

import { submissionDomain, examDomain, virtualContestDomain } from "@nojv/domain";

const { listProblemSubmissions } = submissionDomain;
const { getExamProblemView, getExamProblemViewByProblemId } = examDomain;
const { listVirtualContestProblemSubmissions } = virtualContestDomain;

function row(overrides: Partial<{ id: string; status: string }> = {}) {
  return {
    id: overrides.id ?? "sub_1",
    createdAt: new Date("2026-05-29T00:00:00Z"),
    language: "cpp",
    status: overrides.status ?? "wrong_answer",
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
    getProblemPageData.mockResolvedValue({ id: "prob_1", title: "P1" });
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
});

describe("listVirtualContestProblemSubmissions — verdict-detail blob fallback", () => {
  beforeEach(() => {
    submissionListByUserAndProblem.mockResolvedValue([row()]);
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
});
