import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@temporalio/activity", () => ({
  log: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const { updateReportStatus, listSubmissionsForCheck, saveResults, markReportFailed } =
  vi.hoisted(() => ({
    updateReportStatus: vi.fn(),
    listSubmissionsForCheck: vi.fn(),
    saveResults: vi.fn(),
    markReportFailed: vi.fn(),
  }));

vi.mock("@nojv/domain", () => ({
  plagiarismDomain: {
    updateReportStatus,
    listSubmissionsForCheck,
    saveResults,
    markReportFailed,
  },
}));

import { runPlagiarismCheck } from "../../../apps/worker/src/activities/plagiarism";

const target = { type: "assessment" as const, id: "asg_1" };

const IDENTICAL_PY = `def solve(n):
    total = 0
    for i in range(n):
        total += i * i
        total -= i
    return total
`;

const DIFFERENT_PY = `class Widget:
    def __init__(self, value):
        self.value = value
    def describe(self):
        return f"widget({self.value})"
`;

function sub(
  userId: string,
  problemId: string,
  score: number,
  source: string,
  language = "python",
) {
  return {
    id: `sub_${userId}_${problemId}`,
    userId,
    problemId,
    score,
    language,
    sourceCode: source,
  };
}

beforeEach(() => {
  updateReportStatus.mockReset().mockResolvedValue(undefined);
  listSubmissionsForCheck.mockReset();
  saveResults.mockReset().mockResolvedValue(undefined);
  markReportFailed.mockReset().mockResolvedValue(undefined);
});

describe("runPlagiarismCheck — bookkeeping", () => {
  it("writes status='running' before doing work", async () => {
    listSubmissionsForCheck.mockResolvedValue([]);
    await runPlagiarismCheck(target.id, target.type);
    expect(updateReportStatus).toHaveBeenCalledWith(target, "running");
  });

  it("short-circuits to empty results when there are no accepted submissions", async () => {
    listSubmissionsForCheck.mockResolvedValue([]);
    await runPlagiarismCheck(target.id, target.type);
    expect(saveResults).toHaveBeenCalledWith(target, { pairs: [] }, null);
  });
});

describe("runPlagiarismCheck — dedup + grouping (integration with real Dolos)", () => {
  it("keeps only the best-scoring submission per (user, problem) before pairing", async () => {
    listSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 50, DIFFERENT_PY),
      sub("usr_a", "prob_1", 100, IDENTICAL_PY),
      sub("usr_b", "prob_1", 80, IDENTICAL_PY),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, payload] = saveResults.mock.calls[0];
    expect(payload.pairs).toHaveLength(1);
    expect(payload.pairs[0]).toMatchObject({
      problemId: "prob_1",
      userId1: "usr_a",
      userId2: "usr_b",
    });
    expect(payload.pairs[0].similarity).toBeGreaterThanOrEqual(90);
  });

  it("skips groups with fewer than 2 submissions", async () => {
    listSubmissionsForCheck.mockResolvedValue([sub("usr_a", "prob_solo", 100, IDENTICAL_PY)]);
    await runPlagiarismCheck(target.id, target.type);
    expect(saveResults).toHaveBeenCalledWith(target, { pairs: [] }, null);
  });

  it("keeps cpp and c in separate groups (one parser per language)", async () => {
    const cppSrc = "int main(){int x=0;for(int i=0;i<10;i++)x+=i;return x;}\n";
    const cSrc = "int main(){int x=0;for(int i=0;i<10;i++)x+=i;return x;}\n";
    listSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, cppSrc, "cpp"),
      sub("usr_b", "prob_1", 100, cSrc, "c"),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, payload] = saveResults.mock.calls[0];
    expect(payload.pairs).toEqual([]);
  });

  it("silently skips submissions in unmapped languages", async () => {
    listSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, "brainfuck_source", "brainfuck"),
      sub("usr_b", "prob_1", 100, IDENTICAL_PY, "python"),
      sub("usr_c", "prob_1", 100, IDENTICAL_PY, "python"),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, payload] = saveResults.mock.calls[0];
    expect(payload.pairs).toHaveLength(1);
    const users = [payload.pairs[0].userId1, payload.pairs[0].userId2].sort(
      (a, b) => Number(a > b) - Number(a < b),
    );
    expect(users).toEqual(["usr_b", "usr_c"]);
  });
});

describe("runPlagiarismCheck — pair emission", () => {
  it("emits similarity as an integer 0..100 on an identical-source pair", async () => {
    listSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, IDENTICAL_PY),
      sub("usr_b", "prob_1", 100, IDENTICAL_PY),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, payload] = saveResults.mock.calls[0];
    expect(payload.pairs).toHaveLength(1);
    const pair = payload.pairs[0];
    expect(Number.isInteger(pair.similarity)).toBe(true);
    expect(pair.similarity).toBeGreaterThanOrEqual(90);
    expect(pair.similarity).toBeLessThanOrEqual(100);
    expect(pair.longest).toBeGreaterThan(0);
    expect(pair.overlap).toBeGreaterThan(0);
  });

  it("reports near-zero similarity on clearly different submissions", async () => {
    listSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, IDENTICAL_PY),
      sub("usr_b", "prob_1", 100, DIFFERENT_PY),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, payload] = saveResults.mock.calls[0];
    if (payload.pairs.length > 0) {
      expect(payload.pairs[0].similarity).toBeLessThan(30);
    }
  });

  it("strips file extension from user ids in the persisted pair", async () => {
    listSubmissionsForCheck.mockResolvedValue([
      sub("usr_a", "prob_1", 100, IDENTICAL_PY),
      sub("usr_b", "prob_1", 100, IDENTICAL_PY),
    ]);

    await runPlagiarismCheck(target.id, target.type);

    const [, payload] = saveResults.mock.calls[0];
    expect(payload.pairs[0].userId1).not.toContain(".");
    expect(payload.pairs[0].userId2).not.toContain(".");
  });
});

describe("runPlagiarismCheck — error handling", () => {
  it("marks the report failed and rethrows when the domain layer errors", async () => {
    const boom = new Error("fetchSubmissions blew up");
    listSubmissionsForCheck.mockRejectedValue(boom);

    await expect(runPlagiarismCheck(target.id, target.type)).rejects.toThrow(boom);
    expect(markReportFailed).toHaveBeenCalledWith(target);
    expect(saveResults).not.toHaveBeenCalled();
  });
});
