import type { RawCaseRun, ValidatorOutcome } from "@nojv/core";
import { describe, expect, it } from "vitest";

import { mergeCheckerResults } from "../../../apps/worker/src/services/check-standard";

function rawRun(overrides: Partial<RawCaseRun> & { index: number }): RawCaseRun {
  return { stdout: "", stderr: "", exitCode: 0, timeMs: 5, ...overrides };
}

describe("mergeCheckerResults", () => {
  it("takes the validator AC verdict and defaults score to 100", () => {
    const [result] = mergeCheckerResults(
      [rawRun({ index: 0, stdout: "out" })],
      new Map<number, ValidatorOutcome>([[0, { verdict: "AC" }]]),
    );
    expect(result!.verdict).toBe("AC");
    expect(result!.score).toBe(100);
    expect(result!.stdout).toBe("out");
  });

  it("takes the validator WA verdict and defaults score to 0", () => {
    const [result] = mergeCheckerResults(
      [rawRun({ index: 0 })],
      new Map<number, ValidatorOutcome>([[0, { verdict: "WA" }]]),
    );
    expect(result!.verdict).toBe("WA");
    expect(result!.score).toBe(0);
  });

  it("honors a partial score from the validator", () => {
    const [result] = mergeCheckerResults(
      [rawRun({ index: 0 })],
      new Map<number, ValidatorOutcome>([[0, { verdict: "WA", score: 50 }]]),
    );
    expect(result!.verdict).toBe("WA");
    expect(result!.score).toBe(50);
  });

  it("surfaces teamMessage as student feedback and judgeMessage as staffFeedback", () => {
    const [result] = mergeCheckerResults(
      [rawRun({ index: 0 })],
      new Map<number, ValidatorOutcome>([
        [0, { verdict: "WA", teamMessage: "off by one", judgeMessage: "secret answer was 42" }],
      ]),
    );
    expect(result!.feedback).toBe("off by one");
    expect(result!.staffFeedback).toBe("secret answer was 42");
    expect(JSON.stringify(result)).not.toContain("judgeMessage");
  });

  it("omits staffFeedback when the validator did not emit judgeMessage", () => {
    const [result] = mergeCheckerResults(
      [rawRun({ index: 0 })],
      new Map<number, ValidatorOutcome>([[0, { verdict: "AC", teamMessage: "ok" }]]),
    );
    expect(result!.feedback).toBe("ok");
    expect(result).not.toHaveProperty("staffFeedback");
  });

  it.each(["TLE", "MLE", "RE", "SE"] as const)(
    "passes through the %s run error verdict without consulting the validator",
    (errorVerdict) => {
      const [result] = mergeCheckerResults(
        [rawRun({ index: 0, errorVerdict, stderr: "boom" })],
        new Map<number, ValidatorOutcome>([[0, { verdict: "AC" }]]),
      );
      expect(result!.verdict).toBe(errorVerdict);
      expect(result!.score).toBe(0);
      expect(result!.stderr).toBe("boom");
    },
  );

  it("marks a clean run with no validator outcome as SE", () => {
    const [result] = mergeCheckerResults(
      [rawRun({ index: 0 })],
      new Map<number, ValidatorOutcome>(),
    );
    expect(result!.verdict).toBe("SE");
    expect(result!.score).toBe(0);
  });

  it("treats a validator SE outcome as SE", () => {
    const [result] = mergeCheckerResults(
      [rawRun({ index: 0 })],
      new Map<number, ValidatorOutcome>([[0, { verdict: "SE" }]]),
    );
    expect(result!.verdict).toBe("SE");
  });

  it("carries run telemetry onto the merged result", () => {
    const [result] = mergeCheckerResults(
      [rawRun({ index: 2, timeMs: 123, memoryKb: 4096, exitCode: 0 })],
      new Map<number, ValidatorOutcome>([[2, { verdict: "AC" }]]),
    );
    expect(result!.index).toBe(2);
    expect(result!.timeMs).toBe(123);
    expect(result!.memoryKb).toBe(4096);
  });
});
