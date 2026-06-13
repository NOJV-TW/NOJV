import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  findByIdWithJudgeContext,
  readTestcaseBlobs,
  readWorkspaceFileBlob,
  readValidatorScriptBlob,
} = vi.hoisted(() => ({
  findByIdWithJudgeContext: vi.fn(),
  readTestcaseBlobs: vi.fn(),
  readWorkspaceFileBlob: vi.fn(),
  readValidatorScriptBlob: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: {
    findByIdWithJudgeContext,
  },
}));

vi.mock("../../../packages/application/src/problem/blobs", () => ({
  readTestcaseBlobs,
  readWorkspaceFileBlob,
  readValidatorScriptBlob,
}));

import { submissionDomain, IntegrityError, NotFoundError } from "@nojv/application";

const { getJudgeContext, deriveJudgeMode } = submissionDomain;

function mkProblemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "prob_1",
    type: "full_source",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    judgeConfig: {
      type: "standard",
      runtime: { env: { CC: "gcc" }, timeLimitMs: 1000, memoryLimitMb: 256 },
    },
    samples: [{ input: "1\n", output: "1\n" }],
    advancedImageRef: null,
    advancedImageSource: null,
    testcaseSets: [
      {
        id: "ts_1",
        name: "main",
        weight: 100,
        scoringStrategy: "ALL_OR_NOTHING",
        testcases: [
          {
            id: "tc_1",
            inputKey: "tests/prob_1/tc_1/input.txt",
            outputKey: "tests/prob_1/tc_1/output.txt",
            inputFileKeys: null,
          },
        ],
      },
    ],
    workspaceFiles: [
      {
        path: "main.cpp",
        language: "cpp",
        contentKey: "ws/prob_1/main.cpp",
        visibility: "editable",
      },
    ],
    ...overrides,
  };
}

function mkSubmissionRow(
  overrides: Partial<Record<string, unknown>> = {},
  problemOverrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: "sub_1",
    createdAt: new Date("2026-04-20T12:00:00Z"),
    assessment: null,
    contest: null,
    problem: mkProblemRow(problemOverrides),
    ...overrides,
  };
}

describe("getJudgeContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readTestcaseBlobs.mockResolvedValue({
      input: "1 2",
      output: "3",
      inputFiles: undefined,
    });
    readWorkspaceFileBlob.mockResolvedValue("// starter\n");
    readValidatorScriptBlob.mockResolvedValue("");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws NotFoundError when the submission row is missing", async () => {
    findByIdWithJudgeContext.mockResolvedValue(null);
    await expect(getJudgeContext("sub_missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("loads testcase blobs through the storage helper for every testcase", async () => {
    findByIdWithJudgeContext.mockResolvedValue(mkSubmissionRow());

    const ctx = await getJudgeContext("sub_1");

    expect(readTestcaseBlobs).toHaveBeenCalledTimes(1);
    expect(readTestcaseBlobs).toHaveBeenCalledWith({
      inputKey: "tests/prob_1/tc_1/input.txt",
      outputKey: "tests/prob_1/tc_1/output.txt",
      inputFileKeys: null,
    });
    expect(ctx.testcaseSets).toHaveLength(1);
    expect(ctx.testcaseSets[0]!.testcases[0]!.input).toBe("1 2");
    expect(ctx.testcaseSets[0]!.testcases[0]!.output).toBe("3");
  });

  it("loads workspace files through the workspace blob helper", async () => {
    findByIdWithJudgeContext.mockResolvedValue(mkSubmissionRow());
    readWorkspaceFileBlob.mockResolvedValue("// my starter\n");

    const ctx = await getJudgeContext("sub_1");
    expect(readWorkspaceFileBlob).toHaveBeenCalledWith("ws/prob_1/main.cpp");
    expect(ctx.workspaceFiles).toEqual([
      {
        path: "main.cpp",
        language: "cpp",
        content: "// my starter\n",
        visibility: "editable",
      },
    ]);
  });

  it("fetches the checker script from storage via judgeConfig.checkerKey", async () => {
    const row = mkSubmissionRow(
      {},
      {
        judgeConfig: {
          type: "checker",
          checkerKey: "problems/prob_1/validator/checker",
          interactorKey: null,
          runtime: { env: {}, timeLimitMs: 1000, memoryLimitMb: 256 },
        },
      },
    );
    findByIdWithJudgeContext.mockResolvedValue(row);
    readValidatorScriptBlob.mockResolvedValue("checker source");

    const ctx = await getJudgeContext("sub_1");
    expect(ctx.judgeType).toBe("checker");
    expect(readValidatorScriptBlob).toHaveBeenCalledWith("problems/prob_1/validator/checker");
    expect(ctx.checkerScript).toBe("checker source");
    expect(ctx.interactorScript).toBeNull();
  });

  it("fetches the interactor script from storage via judgeConfig.interactorKey", async () => {
    const row = mkSubmissionRow(
      {},
      {
        judgeConfig: {
          type: "interactive",
          interactorKey: "problems/prob_1/validator/interactor",
          runtime: { env: {}, timeLimitMs: 1000, memoryLimitMb: 256 },
        },
      },
    );
    findByIdWithJudgeContext.mockResolvedValue(row);
    readValidatorScriptBlob.mockResolvedValue("interactor source");

    const ctx = await getJudgeContext("sub_1");
    expect(ctx.judgeType).toBe("interactive");
    expect(readValidatorScriptBlob).toHaveBeenCalledWith(
      "problems/prob_1/validator/interactor",
    );
    expect(ctx.interactorScript).toBe("interactor source");
  });

  it("falls back to standard judge type when judgeConfig is null", async () => {
    const row = mkSubmissionRow({}, { judgeConfig: null });
    findByIdWithJudgeContext.mockResolvedValue(row);

    const ctx = await getJudgeContext("sub_1");
    expect(ctx.judgeType).toBe("standard");
    expect(ctx.checkerScript).toBeNull();
    expect(ctx.interactorScript).toBeNull();
    expect(readValidatorScriptBlob).not.toHaveBeenCalled();
  });

  it("fails closed when persisted judgeConfig is invalid", async () => {
    const row = mkSubmissionRow({}, { judgeConfig: { type: "not-a-judge" } });
    findByIdWithJudgeContext.mockResolvedValue(row);

    await expect(getJudgeContext("sub_1")).rejects.toBeInstanceOf(IntegrityError);
  });

  it("fails closed when persisted testcase inputFileKeys is invalid", async () => {
    const row = mkSubmissionRow(
      {},
      {
        testcaseSets: [
          {
            id: "ts_1",
            name: "main",
            weight: 100,
            scoringStrategy: "ALL_OR_NOTHING",
            testcases: [
              {
                id: "tc_bad",
                inputKey: "in",
                outputKey: "out",
                inputFileKeys: { "a.txt": 42 },
              },
            ],
          },
        ],
      },
    );
    findByIdWithJudgeContext.mockResolvedValue(row);

    await expect(getJudgeContext("sub_1")).rejects.toBeInstanceOf(IntegrityError);
  });

  it("fails closed when persisted assignment adjustmentRules is invalid", async () => {
    const row = mkSubmissionRow({
      assessment: {
        dueAt: new Date("2026-04-20T00:00:00Z"),
        closesAt: new Date("2026-04-21T00:00:00Z"),
        adjustmentRules: { late: "not-an-array" },
      },
    });
    findByIdWithJudgeContext.mockResolvedValue(row);

    await expect(getJudgeContext("sub_1")).rejects.toBeInstanceOf(IntegrityError);
  });

  it("falls back to problem time/memory limits when judgeConfig.runtime is missing", async () => {
    const row = mkSubmissionRow(
      {},
      {
        timeLimitMs: 2500,
        memoryLimitMb: 512,
        judgeConfig: { type: "standard" }, // no runtime field
      },
    );
    findByIdWithJudgeContext.mockResolvedValue(row);

    const ctx = await getJudgeContext("sub_1");
    expect(ctx.runtime.timeLimitMs).toBe(2500);
    expect(ctx.runtime.memoryLimitMb).toBe(512);
    expect(ctx.runtime.env).toEqual({});
  });

  it("collects samples but only well-formed { input, output } pairs", async () => {
    const row = mkSubmissionRow(
      {},
      {
        samples: [
          { input: "1 2", output: "3" },
          { input: "ok", output: "ok" },
          { input: "missing-output" }, // dropped
          "garbage", // dropped
          null, // dropped
        ],
      },
    );
    findByIdWithJudgeContext.mockResolvedValue(row);

    const ctx = await getJudgeContext("sub_1");
    expect(ctx.samples).toEqual([
      { input: "1 2", output: "3" },
      { input: "ok", output: "ok" },
    ]);
  });

  it("returns an empty samples array when the column is not an array", async () => {
    const row = mkSubmissionRow({}, { samples: null });
    findByIdWithJudgeContext.mockResolvedValue(row);

    const ctx = await getJudgeContext("sub_1");
    expect(ctx.samples).toEqual([]);
  });

  it("builds subtaskStrategies map from the testcase sets", async () => {
    const row = mkSubmissionRow(
      {},
      {
        testcaseSets: [
          {
            id: "ts_a",
            name: "A",
            weight: 50,
            scoringStrategy: "ALL_OR_NOTHING",
            testcases: [
              {
                id: "tc_a1",
                inputKey: "k1",
                outputKey: "o1",
                inputFileKeys: null,
              },
            ],
          },
          {
            id: "ts_b",
            name: "B",
            weight: 50,
            scoringStrategy: "PROPORTIONAL",
            testcases: [
              {
                id: "tc_b1",
                inputKey: "k2",
                outputKey: "o2",
                inputFileKeys: null,
              },
            ],
          },
        ],
      },
    );
    findByIdWithJudgeContext.mockResolvedValue(row);

    const ctx = await getJudgeContext("sub_1");
    expect(ctx.subtaskStrategies).toEqual({
      ts_a: "ALL_OR_NOTHING",
      ts_b: "PROPORTIONAL",
    });
  });

  describe("advanced mode", () => {
    it("returns advanced=null for non-special_env problems", async () => {
      findByIdWithJudgeContext.mockResolvedValue(mkSubmissionRow());
      const ctx = await getJudgeContext("sub_1");
      expect(ctx.advanced).toBeNull();
      expect(ctx.problemType).toBe("full_source");
    });

    it("populates the advanced context for special_env problems", async () => {
      const row = mkSubmissionRow(
        {},
        {
          type: "special_env",
          advancedImageRef: "registry.example.com/judge:v1",
          advancedImageSource: "registry",
          timeLimitMs: 5000,
          memoryLimitMb: 1024,
        },
      );
      findByIdWithJudgeContext.mockResolvedValue(row);

      const ctx = await getJudgeContext("sub_1");
      expect(ctx.problemType).toBe("special_env");
      expect(ctx.advanced).toEqual({
        imageRef: "registry.example.com/judge:v1",
        imageSource: "registry",
        resourceLimits: { totalTimeMs: 5000, memoryMb: 1024 },
      });
    });

    it("returns advanced=null for special_env when imageRef is missing (config not yet attached)", async () => {
      const row = mkSubmissionRow(
        {},
        {
          type: "special_env",
          advancedImageRef: null,
          advancedImageSource: "registry",
        },
      );
      findByIdWithJudgeContext.mockResolvedValue(row);

      const ctx = await getJudgeContext("sub_1");
      expect(ctx.advanced).toBeNull();
    });
  });

  describe("deriveJudgeMode", () => {
    it('returns "advanced" for special_env with non-null advanced context', () => {
      expect(
        deriveJudgeMode({
          problemType: "special_env",
          advanced: {
            imageRef: "registry.example.com/judge:v1",
            imageSource: "registry",
            resourceLimits: { totalTimeMs: 5000, memoryMb: 1024 },
          },
        }),
      ).toBe("advanced");
    });

    it('returns "standard" for non-special_env problems', () => {
      expect(deriveJudgeMode({ problemType: "full_source", advanced: null })).toBe("standard");
    });

    it('returns "standard" when problemType is special_env but advanced is null', () => {
      expect(deriveJudgeMode({ problemType: "special_env", advanced: null })).toBe("standard");
    });
  });

  describe("adjustment context", () => {
    it("uses assessment.dueAt and closesAt when the submission belongs to an assessment", async () => {
      const dueAt = new Date("2026-04-19T12:00:00Z");
      const closesAt = new Date("2026-04-21T12:00:00Z");
      const row = mkSubmissionRow({
        assessment: {
          adjustmentRules: [{ type: "flat_late_penalty", penaltyPct: 10, startFrom: "due" }],
          dueAt,
          closesAt,
          opensAt: new Date("2026-04-15T00:00:00Z"),
        },
      });
      findByIdWithJudgeContext.mockResolvedValue(row);

      const ctx = await getJudgeContext("sub_1");
      expect(ctx.adjustment.dueAt).toEqual(dueAt);
      expect(ctx.adjustment.finalDay).toEqual(closesAt);
      expect(ctx.adjustment.assignmentAdjustmentRules).toHaveLength(1);
      expect(ctx.adjustment.submittedAt).toEqual(row.createdAt);
    });

    it("falls back to contest.endsAt when the submission belongs to a contest (no assessment)", async () => {
      const endsAt = new Date("2026-04-20T18:00:00Z");
      const row = mkSubmissionRow({
        contest: {
          startsAt: new Date("2026-04-20T10:00:00Z"),
          endsAt,
        },
      });
      findByIdWithJudgeContext.mockResolvedValue(row);

      const ctx = await getJudgeContext("sub_1");
      expect(ctx.adjustment.dueAt).toEqual(endsAt);
      expect(ctx.adjustment.finalDay).toEqual(endsAt);
      expect(ctx.adjustment.assignmentAdjustmentRules).toBeFalsy();
    });

    it("returns null dueAt / finalDay for free-practice submissions (no context)", async () => {
      findByIdWithJudgeContext.mockResolvedValue(mkSubmissionRow());
      const ctx = await getJudgeContext("sub_1");
      expect(ctx.adjustment.dueAt).toBeNull();
      expect(ctx.adjustment.finalDay).toBeNull();
      expect(ctx.adjustment.assignmentAdjustmentRules).toBeFalsy();
    });
  });
});
