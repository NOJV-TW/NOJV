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
  subtaskStrategies: {},
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

  it("system_error stays out of the graded/counted verdict set", () => {
    expect(submissionVerdicts as readonly string[]).not.toContain("system_error");
  });
});
