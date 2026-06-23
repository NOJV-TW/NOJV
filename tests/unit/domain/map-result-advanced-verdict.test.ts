import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
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

describe("mapResult — advanced-mode overallVerdict precedence", () => {
  it("honors a graded WA even when a custom score is present", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [
        mkCase({ index: 0, verdict: "AC" }),
        mkCase({ index: 1, verdict: "WA" }),
      ],
      customScore: 100,
      overallVerdict: "WA",
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result.verdict).toBe("wrong_answer");
    expect(result.accepted).toBe(false);
    expect(result.score).toBe(100);
  });

  it("honors a graded AC even when a per-case result is WA", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [
        mkCase({ index: 0, verdict: "AC" }),
        mkCase({ index: 1, verdict: "WA" }),
      ],
      customScore: 100,
      overallVerdict: "AC",
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result.verdict).toBe("accepted");
    expect(result.accepted).toBe(true);
    expect(result.score).toBe(100);
  });
});
