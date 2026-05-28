import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/domain";
import type { SubmissionResult } from "@nojv/core";

const { stripStaffFeedback } = submissionDomain;

function mkResult(overrides: Partial<SubmissionResult>): SubmissionResult {
  return {
    accepted: false,
    feedback: "fail",
    runtimeMs: 0,
    score: 0,
    verdict: "wrong_answer",
    ...overrides,
  };
}

describe("stripStaffFeedback", () => {
  it("removes staffFeedback from every caseResult entry", () => {
    const stripped = stripStaffFeedback(
      mkResult({
        caseResults: [
          { index: 0, verdict: "WA", timeMs: 5, staffFeedback: "expected 42" },
          { index: 1, verdict: "AC", timeMs: 3 },
        ],
      }),
    );

    expect(stripped.caseResults![0]).not.toHaveProperty("staffFeedback");
    expect(stripped.caseResults![1]).not.toHaveProperty("staffFeedback");
    // The serialized payload that goes to the client must not contain the field.
    expect(JSON.stringify(stripped)).not.toContain("staffFeedback");
  });

  it("removes staffFeedback from nested subtaskResults.cases entries too", () => {
    const stripped = stripStaffFeedback(
      mkResult({
        subtaskResults: [
          {
            testcaseSetId: "ts1",
            label: "Subtask 1",
            weight: 100,
            passed: false,
            cases: [
              { index: 0, verdict: "WA", timeMs: 5, staffFeedback: "expected 42" },
              { index: 1, verdict: "AC", timeMs: 3 },
            ],
          },
        ],
      }),
    );

    expect(stripped.subtaskResults![0]!.cases[0]).not.toHaveProperty("staffFeedback");
    expect(JSON.stringify(stripped)).not.toContain("staffFeedback");
  });

  it("preserves every other field on the result", () => {
    const input = mkResult({
      caseResults: [{ index: 0, verdict: "AC", timeMs: 5, stdout: "hi", staffFeedback: "x" }],
      runtimeMs: 12,
      score: 100,
    });
    const stripped = stripStaffFeedback(input);

    expect(stripped.runtimeMs).toBe(12);
    expect(stripped.score).toBe(100);
    expect(stripped.caseResults![0]!.stdout).toBe("hi");
    expect(stripped.caseResults![0]!.verdict).toBe("AC");
  });

  it("is a no-op when no case carries staffFeedback", () => {
    const input = mkResult({
      caseResults: [{ index: 0, verdict: "AC", timeMs: 5 }],
    });
    const stripped = stripStaffFeedback(input);
    expect(stripped.caseResults).toEqual(input.caseResults);
  });
});
