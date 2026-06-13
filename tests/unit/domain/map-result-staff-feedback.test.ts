import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import { caseResultSchema } from "@nojv/core";
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

describe("mapResult — staffFeedback carry-through", () => {
  it("copies staffFeedback from each SandboxTestcaseResult onto the persisted caseResult", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [
        mkCase({
          index: 0,
          verdict: "WA",
          feedback: "off by one",
          staffFeedback: "expected 42",
        }),
        mkCase({ index: 1, verdict: "AC" }),
      ],
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result.caseResults).toBeDefined();
    expect(result.caseResults![0]!.staffFeedback).toBe("expected 42");
    expect(result.caseResults![1]).not.toHaveProperty("staffFeedback");
  });

  it("omits staffFeedback when the sandbox did not emit one", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [mkCase({ index: 0, verdict: "WA", feedback: "wrong" })],
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result.caseResults![0]).not.toHaveProperty("staffFeedback");
  });

  it("persisted caseResult shape passes the caseResultSchema with staffFeedback", () => {
    const parsed = caseResultSchema.parse({
      index: 0,
      verdict: "WA",
      timeMs: 5,
      staffFeedback: "expected 42",
    });
    expect(parsed.staffFeedback).toBe("expected 42");
  });
});
