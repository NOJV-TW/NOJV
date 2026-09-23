import type { RawCaseRun, SandboxTestcase, ValidatorOutcome } from "@nojv/core";
import { describe, expect, it } from "vitest";

import { resolveStandardResults } from "../../../apps/worker/src/services/check-standard";

function testcase(index: number, output?: string): SandboxTestcase {
  return {
    index,
    input: "",
    ...(output !== undefined ? { output } : {}),
    weight: 1,
    isSample: false,
  };
}

function rawRun(overrides: Partial<RawCaseRun> & { index: number }): RawCaseRun {
  return { stdout: "", stderr: "", exitCode: 0, timeMs: 5, ...overrides };
}

function judged(verdicts: Record<number, ValidatorOutcome["verdict"]>) {
  return new Map(
    Object.entries(verdicts).map(([index, verdict]) => [Number(index), { verdict }] as const),
  );
}

describe("resolveStandardResults", () => {
  it("takes AC from the judge outcome and keeps the run output", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "42\n\n" })],
      [testcase(0, "42")],
      judged({ 0: "AC" }),
    );
    expect(result!.verdict).toBe("AC");
    expect(result!.stdout).toBe("42\n\n");
  });

  it("takes WA from the judge outcome", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "41" })],
      [testcase(0, "42")],
      judged({ 0: "WA" }),
    );
    expect(result!.verdict).toBe("WA");
  });

  it("returns SE when the judge did not report an answered case", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "42" })],
      [testcase(0, "42")],
      new Map(),
    );
    expect(result!.verdict).toBe("SE");
    expect(result!.staffFeedback).toBe("Judge did not report case 0.");
  });

  it.each(["TLE", "MLE", "RE", "SE"] as const)(
    "passes through the %s error verdict",
    (errorVerdict) => {
      const [result] = resolveStandardResults(
        [rawRun({ index: 0, errorVerdict, stderr: "boom", exitCode: 1 })],
        [testcase(0, "42")],
        new Map(),
      );
      expect(result!.verdict).toBe(errorVerdict);
      expect(result!.stderr).toBe("boom");
      if (errorVerdict === "RE") expect(result!.feedback).toBe("boom");
      if (errorVerdict === "TLE") expect(result!.feedback).toBe("Time limit exceeded.");
      if (errorVerdict === "MLE") expect(result!.feedback).toBe("Memory limit exceeded.");
      if (errorVerdict === "SE") expect(result).not.toHaveProperty("feedback");
    },
  );

  it("uses a fallback diagnostic when a runtime error has no stderr", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, errorVerdict: "RE", stderr: "" })],
      [testcase(0, "42")],
      new Map(),
    );
    expect(result!.feedback).toBe("Runtime error.");
  });

  it("returns SE when the matching testcase has no expected output", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "42" })],
      [testcase(0)],
      new Map(),
    );
    expect(result!.verdict).toBe("SE");
    expect(result!.feedback).toMatch(/missing expected output/i);
  });

  it("allows custom sample runs without an expected answer while preserving failures", () => {
    const cases = [{ ...testcase(0), isSample: true }];
    expect(
      resolveStandardResults([rawRun({ index: 0, stdout: "42" })], cases, new Map())[0]
        ?.verdict,
    ).toBe("AC");
    expect(
      resolveStandardResults(
        [rawRun({ index: 0, errorVerdict: "RE", exitCode: 1 })],
        cases,
        new Map(),
      )[0]?.verdict,
    ).toBe("RE");
    expect(
      resolveStandardResults(
        [rawRun({ index: 0, stdout: "42" })],
        [{ ...testcase(0, ""), isSample: true }],
        judged({ 0: "WA" }),
      )[0]?.verdict,
    ).toBe("WA");
  });

  it("returns SE when no testcase matches the run index", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 7, stdout: "42" })],
      [testcase(0, "42")],
      judged({ 0: "AC" }),
    );
    expect(result!.verdict).toBe("SE");
  });

  it("carries run telemetry onto the result", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "42", timeMs: 123, memoryKb: 4096, exitCode: 0 })],
      [testcase(0, "42")],
      judged({ 0: "AC" }),
    );
    expect(result!.timeMs).toBe(123);
    expect(result!.memoryKb).toBe(4096);
    expect(result!.exitCode).toBe(0);
  });

  it("matches testcases by index, not array position", () => {
    const results = resolveStandardResults(
      [rawRun({ index: 1, stdout: "b" }), rawRun({ index: 0, stdout: "a" })],
      [testcase(0, "a"), testcase(1, "b")],
      judged({ 0: "AC", 1: "AC" }),
    );
    expect(results.find((r) => r.index === 0)!.verdict).toBe("AC");
    expect(results.find((r) => r.index === 1)!.verdict).toBe("AC");
  });
});
