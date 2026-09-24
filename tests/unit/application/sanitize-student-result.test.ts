import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import type { SubmissionResult } from "@nojv/core";

const { sanitizeStudentResult } = submissionDomain;

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

describe("sanitizeStudentResult", () => {
  it("strips stdout and stderr from every graded caseResult (hidden testcase input leak)", () => {
    const sanitized = sanitizeStudentResult(
      mkResult({
        caseResults: [
          {
            index: 0,
            verdict: "WA",
            timeMs: 5,
            stdout: "5\n1 2 3 4 5",
            stderr: "diag",
            staffFeedback: "expected 42",
          },
          { index: 1, verdict: "AC", timeMs: 3, stdout: "hidden-input-echo" },
        ],
      }),
      { sampleOnly: false },
    );

    for (const c of sanitized.caseResults ?? []) {
      expect(c).not.toHaveProperty("stdout");
      expect(c).not.toHaveProperty("stderr");
      expect(c).not.toHaveProperty("staffFeedback");
    }
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("stdout");
    expect(serialized).not.toContain("hidden-input-echo");
    expect(serialized).not.toContain("staffFeedback");
  });

  it("also strips stdout/stderr from nested subtaskResults.cases on graded reads", () => {
    const sanitized = sanitizeStudentResult(
      mkResult({
        subtaskResults: [
          {
            testcaseSetId: "ts1",
            label: "Subtask 1",
            weight: 100,
            passed: false,
            cases: [
              { index: 0, verdict: "WA", timeMs: 5, stdout: "leak", stderr: "e" },
              { index: 1, verdict: "AC", timeMs: 3 },
            ],
          },
        ],
      }),
      { sampleOnly: false },
    );

    expect(sanitized.subtaskResults![0]!.cases[0]).not.toHaveProperty("stdout");
    expect(sanitized.subtaskResults![0]!.cases[0]).not.toHaveProperty("stderr");
    expect(JSON.stringify(sanitized)).not.toContain("leak");
  });

  it("keeps stdout/stderr on sample-only (Run) submissions so students see their own output", () => {
    const sanitized = sanitizeStudentResult(
      mkResult({
        caseResults: [{ index: 0, verdict: "AC", timeMs: 5, stdout: "hello", stderr: "warn" }],
      }),
      { sampleOnly: true },
    );

    expect(sanitized.caseResults![0]!.stdout).toBe("hello");
    expect(sanitized.caseResults![0]!.stderr).toBe("warn");
  });

  it("always removes staffFeedback regardless of sampleOnly", () => {
    const sanitized = sanitizeStudentResult(
      mkResult({
        caseResults: [
          { index: 0, verdict: "AC", timeMs: 5, stdout: "hello", staffFeedback: "secret" },
        ],
      }),
      { sampleOnly: true },
    );

    expect(sanitized.caseResults![0]).not.toHaveProperty("staffFeedback");
    expect(JSON.stringify(sanitized)).not.toContain("staffFeedback");
  });
});
