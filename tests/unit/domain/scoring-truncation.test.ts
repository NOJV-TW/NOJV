import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/domain";
import {
  MAX_CASE_STDERR_BYTES,
  MAX_CASE_STDOUT_BYTES,
  MAX_FEEDBACK_LEN,
  submissionResultSchema,
} from "@nojv/core";
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

describe("mapResult — oversized output is truncated, never throws ZodError", () => {
  it("truncates per-case stdout/stderr below the schema caps", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [
        mkCase({
          index: 0,
          verdict: "WA",
          stdout: "x".repeat(MAX_CASE_STDOUT_BYTES + 5_000),
          stderr: "e".repeat(MAX_CASE_STDERR_BYTES + 5_000),
        }),
      ],
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result.caseResults![0]!.stdout!.length).toBeLessThanOrEqual(MAX_CASE_STDOUT_BYTES);
    expect(result.caseResults![0]!.stderr!.length).toBeLessThanOrEqual(MAX_CASE_STDERR_BYTES);
    expect(() => submissionResultSchema.parse(result)).not.toThrow();
  });

  it("truncates a giant compile error below the feedback cap", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [],
      compilationError: "C".repeat(MAX_FEEDBACK_LEN + 50_000),
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result.verdict).toBe("compile_error");
    expect(result.feedback.length).toBeLessThanOrEqual(MAX_FEEDBACK_LEN);
    expect(() => submissionResultSchema.parse(result)).not.toThrow();
  });
});
