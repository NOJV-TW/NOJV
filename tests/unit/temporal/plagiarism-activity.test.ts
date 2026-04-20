import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Temporal activity logger so the activity runs outside a
// worker context.
vi.mock("@temporalio/activity", () => ({
  log: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the plagiarism domain surface so the activity's side effects are
// observable but no Prisma call is made and no TCP socket is opened.
const { updateReportStatus, fetchSubmissionsForCheck, saveResults, markReportFailed } =
  vi.hoisted(() => ({
    updateReportStatus: vi.fn(),
    fetchSubmissionsForCheck: vi.fn(),
    saveResults: vi.fn(),
    markReportFailed: vi.fn(),
  }));

vi.mock("@nojv/domain", () => ({
  plagiarismDomain: {
    updateReportStatus,
    fetchSubmissionsForCheck,
    saveResults,
    markReportFailed,
  },
}));

import { runPlagiarismCheck } from "../../../packages/temporal/src/activities/plagiarism";

const target = { type: "courseAssessment" as const, id: "asg_1" };

beforeEach(() => {
  updateReportStatus.mockReset();
  fetchSubmissionsForCheck.mockReset();
  saveResults.mockReset();
  markReportFailed.mockReset();
  // Default the void-returning mocks to a resolved Promise. The activity
  // chains `.catch()` on markReportFailed, so `undefined` trips a
  // TypeError before the real assertion runs.
  updateReportStatus.mockResolvedValue(undefined);
  saveResults.mockResolvedValue(undefined);
  markReportFailed.mockResolvedValue(undefined);
  // Keep MOSS offline: empty MOSS_USER_ID triggers the placeholder path
  // so tests never touch moss.stanford.edu.
  delete process.env.MOSS_USER_ID;
});

function sub(userId: string, problemId: string, score: number, language = "cpp") {
  return {
    id: `sub_${userId}_${problemId}_${score}`,
    userId,
    problemId,
    score,
    language,
    sourceCode: `// code ${userId} ${problemId} ${score}`,
  };
}

describe("runPlagiarismCheck — empty + happy-path bookkeeping", () => {
  it("writes status='running' before doing work", async () => {
    fetchSubmissionsForCheck.mockResolvedValue([]);
    await runPlagiarismCheck(target.id, target.type);
    expect(updateReportStatus).toHaveBeenCalledWith(target, "running");
  });

  it("short-circuits to empty results when there are no accepted submissions", async () => {
    fetchSubmissionsForCheck.mockResolvedValue([]);
    await runPlagiarismCheck(target.id, target.type);
    expect(saveResults).toHaveBeenCalledWith(target, { pairs: [] }, null);
  });
});

describe("runPlagiarismCheck — dedup + grouping + pair generation", () => {
  it("keeps only the best-scoring submission per (user, problem) before pairing", async () => {
    fetchSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 50),
      sub("usr_a", "prob_1", 100), // wins over the 50 above
      sub("usr_b", "prob_1", 80),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, results] = saveResults.mock.calls[0];
    expect(results.pairs).toHaveLength(1);
    expect(results.pairs[0]).toMatchObject({
      userId1: "usr_a",
      userId2: "usr_b",
      problemId: "prob_1",
    });
  });

  it("skips groups with fewer than 2 submissions (no pairs emitted)", async () => {
    fetchSubmissionsForCheck.mockResolvedValue([sub("usr_a", "prob_solo", 100)]);
    await runPlagiarismCheck(target.id, target.type);
    const [, results] = saveResults.mock.calls[0];
    expect(results.pairs).toEqual([]);
  });

  it("pairs c + go + rust together under the shared MOSS 'c' bucket", async () => {
    fetchSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, "c"),
      sub("usr_b", "prob_1", 100, "go"),
      sub("usr_c", "prob_1", 100, "rust"),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, results] = saveResults.mock.calls[0];
    // 3 submissions → C(3,2) = 3 pairs
    expect(results.pairs).toHaveLength(3);
  });

  it("keeps cpp in the 'cc' bucket separate from the c-family bucket", async () => {
    fetchSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, "c"),
      sub("usr_b", "prob_1", 100, "cpp"), // cpp → 'cc', a different bucket
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, results] = saveResults.mock.calls[0];
    // Both buckets end up with 1 submission each → both skipped.
    expect(results.pairs).toEqual([]);
  });

  it("silently skips submissions in unmapped languages", async () => {
    fetchSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, "brainfuck"),
      sub("usr_b", "prob_1", 100, "cpp"),
      sub("usr_c", "prob_1", 100, "cpp"),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, results] = saveResults.mock.calls[0];
    // usr_a is dropped (unmapped). usr_b vs usr_c is the only pair.
    expect(results.pairs).toHaveLength(1);
    expect(results.pairs[0]).toMatchObject({ userId1: "usr_b", userId2: "usr_c" });
  });

  it("splits groups across different problems even when language matches", async () => {
    fetchSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, "cpp"),
      sub("usr_b", "prob_1", 100, "cpp"),
      sub("usr_c", "prob_2", 100, "cpp"),
      // prob_2 is a singleton → no pair
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, results] = saveResults.mock.calls[0];
    expect(results.pairs).toHaveLength(1);
    expect(results.pairs[0]).toMatchObject({
      problemId: "prob_1",
      userId1: "usr_a",
      userId2: "usr_b",
    });
  });
});

describe("runPlagiarismCheck — failure path", () => {
  it("marks the report failed and rethrows when the domain layer errors", async () => {
    const boom = new Error("fetchSubmissions blew up");
    fetchSubmissionsForCheck.mockRejectedValue(boom);

    await expect(runPlagiarismCheck(target.id, target.type)).rejects.toThrow(boom);
    expect(markReportFailed).toHaveBeenCalledWith(target);
    expect(saveResults).not.toHaveBeenCalled();
  });
});
