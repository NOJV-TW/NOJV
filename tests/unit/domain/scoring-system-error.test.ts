import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import { submissionResultSchema, submissionVerdicts } from "@nojv/core";
import type { SandboxResult, SandboxTestcaseResult } from "@nojv/core";

const { mapResult } = submissionDomain;

function mkCase(
  overrides: Partial<SandboxTestcaseResult> & { index: number },
): SandboxTestcaseResult {
  return {
    verdict: "AC",
    stdout: "",
    stderr: "",
    exitCode: 0,
    timeMs: 1,
    ...overrides,
  };
}

const NO_ADJUSTMENT = {
  adjustment: {
    assignmentAdjustmentRules: null,
    dueAt: null,
    finalDay: null,
    submittedAt: new Date(),
  },
  compareOptions: null,
};

describe("mapResult — sandbox SE maps to system_error (platform fault)", () => {
  it("maps any SE case to verdict system_error with score 0, not accepted", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [
        mkCase({ index: 0, verdict: "AC" }),
        mkCase({ index: 1, verdict: "SE" }),
      ],
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result.verdict).toBe("system_error");
    expect(result.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it("system_error result passes submissionResultSchema", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [mkCase({ index: 0, verdict: "SE" })],
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(() => submissionResultSchema.parse(result)).not.toThrow();
  });

  it("preserves a platform failure diagnostic even when it prevented other cases running", () => {
    const result = mapResult(
      {
        testcaseResults: [
          mkCase({
            index: 0,
            verdict: "SE",
            feedback: "Interactive judge failed; this submission was not counted.",
            staffFeedback: "Interactor process exited with signal SIGSEGV.",
          }),
        ],
      },
      [],
      NO_ADJUSTMENT as never,
      2,
    );

    expect(result.feedback).toBe("Interactive judge failed; this submission was not counted.");
    expect(result.caseResults?.[0]?.staffFeedback).toBe(
      "Interactor process exited with signal SIGSEGV.",
    );
    expect(result).toMatchObject({ accepted: false, score: 0, verdict: "system_error" });
  });

  it("maps a judge pipeline failure to system_error instead of a student compile error", () => {
    const result = mapResult(
      { pipelineError: "sandbox phase failed", testcaseResults: [] },
      [],
      NO_ADJUSTMENT as never,
    );

    expect(result).toMatchObject({
      verdict: "system_error",
      accepted: false,
      feedback: "[Pipeline Error] sandbox phase failed",
    });
  });

  it("system_error stays out of the graded/counted verdict set", () => {
    expect(submissionVerdicts as readonly string[]).not.toContain("system_error");
  });
});

describe("mapResult — complete testcase contract", () => {
  it.each([[0], [0, 0], [0, 2], [-1, 1], [0, 0.5], [0, 1, 2]])(
    "rejects missing, duplicate or invalid indices: %j",
    (...indices) => {
      const result = mapResult(
        { testcaseResults: indices.map((index) => mkCase({ index })) },
        [],
        NO_ADJUSTMENT as never,
        2,
      );
      expect(result).toMatchObject({ accepted: false, verdict: "system_error", score: 0 });
      expect(result.feedback).toContain("expected 2 distinct testcase results");
      expect(() => submissionResultSchema.parse(result)).not.toThrow();
    },
  );

  it("accepts complete results and preserves sample scoring", () => {
    const result = mapResult(
      { testcaseResults: [mkCase({ index: 0 }), mkCase({ index: 1 })] },
      [],
      NO_ADJUSTMENT as never,
      2,
    );
    expect(result).toMatchObject({ accepted: true, verdict: "accepted", score: 0 });
  });

  it("matches subtask results by index even when executor results arrive out of order", () => {
    const sets = [
      {
        id: "set-1",
        name: "All",
        weight: 100,
        testcases: [
          { id: "case-0", input: "", output: "", inputFiles: {}, weight: 1 },
          { id: "case-1", input: "", output: "", inputFiles: {}, weight: 1 },
        ],
      },
    ];
    const result = mapResult(
      { testcaseResults: [mkCase({ index: 1, verdict: "WA" }), mkCase({ index: 0 })] },
      sets,
      NO_ADJUSTMENT as never,
    );
    expect(
      result.subtaskResults?.[0]?.cases.map(({ testcaseId, verdict }) => [testcaseId, verdict]),
    ).toEqual([
      ["case-0", "AC"],
      ["case-1", "WA"],
    ]);
  });
});
