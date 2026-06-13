import type { RawCaseRun, SandboxTestcase } from "@nojv/core";
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

describe("resolveStandardResults", () => {
  it("returns AC when output matches (after normalization)", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "42\n\n" })],
      [testcase(0, "42")],
    );
    expect(result!.verdict).toBe("AC");
    expect(result!.stdout).toBe("42\n\n");
  });

  it("returns WA when output differs", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "41" })],
      [testcase(0, "42")],
    );
    expect(result!.verdict).toBe("WA");
  });

  it.each(["TLE", "MLE", "RE", "SE"] as const)(
    "passes through the %s error verdict",
    (errorVerdict) => {
      const [result] = resolveStandardResults(
        [rawRun({ index: 0, errorVerdict, stderr: "boom", exitCode: 1 })],
        [testcase(0, "42")],
      );
      expect(result!.verdict).toBe(errorVerdict);
      expect(result!.stderr).toBe("boom");
    },
  );

  it("returns SE when the matching testcase has no expected output", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "42" })],
      [testcase(0)],
    );
    expect(result!.verdict).toBe("SE");
    expect(result!.feedback).toMatch(/missing expected output/i);
  });

  it("returns SE when no testcase matches the run index", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 7, stdout: "42" })],
      [testcase(0, "42")],
    );
    expect(result!.verdict).toBe("SE");
  });

  it("carries run telemetry onto the result", () => {
    const [result] = resolveStandardResults(
      [rawRun({ index: 0, stdout: "42", timeMs: 123, memoryKb: 4096, exitCode: 0 })],
      [testcase(0, "42")],
    );
    expect(result!.timeMs).toBe(123);
    expect(result!.memoryKb).toBe(4096);
    expect(result!.exitCode).toBe(0);
  });

  it("matches testcases by index, not array position", () => {
    const results = resolveStandardResults(
      [rawRun({ index: 1, stdout: "b" }), rawRun({ index: 0, stdout: "a" })],
      [testcase(0, "a"), testcase(1, "b")],
    );
    expect(results.find((r) => r.index === 0)!.verdict).toBe("AC");
    expect(results.find((r) => r.index === 1)!.verdict).toBe("AC");
  });
});
