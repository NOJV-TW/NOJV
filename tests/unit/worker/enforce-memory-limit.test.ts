import { describe, expect, it } from "vitest";

import type { SandboxTestcaseResult } from "@nojv/core";

import { enforceMemoryLimit } from "../../../apps/worker/src/services/check-standard";

function caseResult(over: Partial<SandboxTestcaseResult>): SandboxTestcaseResult {
  return {
    index: 0,
    verdict: "AC",
    stdout: "",
    stderr: "",
    exitCode: 0,
    timeMs: 10,
    score: 100,
    ...over,
  };
}

describe("enforceMemoryLimit", () => {
  const LIMIT_MB = 256;

  it("reclassifies an AC run that exceeded the per-problem memory limit as MLE", () => {
    const out = enforceMemoryLimit([caseResult({ verdict: "AC", memoryKb: 300 * 1024 })], LIMIT_MB);
    expect(out[0]!.verdict).toBe("MLE");
    expect(out[0]!.score).toBe(0);
  });

  it("reclassifies a WA run that exceeded the limit as MLE", () => {
    const out = enforceMemoryLimit(
      [caseResult({ verdict: "WA", score: 0, memoryKb: 257 * 1024 })],
      LIMIT_MB,
    );
    expect(out[0]!.verdict).toBe("MLE");
  });

  it("leaves an AC run under the limit untouched", () => {
    const out = enforceMemoryLimit([caseResult({ verdict: "AC", memoryKb: 100 * 1024 })], LIMIT_MB);
    expect(out[0]!.verdict).toBe("AC");
    expect(out[0]!.score).toBe(100);
  });

  it("does not false-trigger when memoryKb is unmeasured", () => {
    const out = enforceMemoryLimit([caseResult({ verdict: "AC", memoryKb: undefined })], LIMIT_MB);
    expect(out[0]!.verdict).toBe("AC");
  });

  it("leaves run-failure verdicts (TLE/RE/SE) untouched even if memory is high", () => {
    for (const verdict of ["TLE", "RE", "SE"] as const) {
      const out = enforceMemoryLimit(
        [caseResult({ verdict, score: 0, memoryKb: 999 * 1024 })],
        LIMIT_MB,
      );
      expect(out[0]!.verdict).toBe(verdict);
    }
  });

  it("treats exactly-at-limit as acceptable (only strictly-over is MLE)", () => {
    const out = enforceMemoryLimit(
      [caseResult({ verdict: "AC", memoryKb: LIMIT_MB * 1024 })],
      LIMIT_MB,
    );
    expect(out[0]!.verdict).toBe("AC");
  });
});
