import type { AdvancedResult } from "@nojv/core";
import { describe, expect, it } from "vitest";

import {
  ADVANCED_VERDICT_TO_SANDBOX,
  mapAdvancedResult,
  resolveAdvancedResult,
} from "../../../apps/worker/src/sandbox/shared/sandbox-result-mapper";

describe("mapAdvancedResult", () => {
  it("surfaces compile_error via compilationError, not a per-case RE", () => {
    const result: AdvancedResult = {
      score: 0,
      verdict: "compile_error",
      feedback: "missing semicolon on line 7",
    };
    const mapped = mapAdvancedResult(result);
    expect(mapped.compilationError).toBe("missing semicolon on line 7");
    expect(mapped.testcaseResults).toEqual([]);
  });

  it("falls back to a default message when compile_error has no feedback", () => {
    const mapped = mapAdvancedResult({ score: 0, verdict: "compile_error" });
    expect(mapped.compilationError).toBe("Compilation failed in the judge image.");
  });

  it("emits one synthetic AC case when no per-case detail is present", () => {
    const mapped = mapAdvancedResult({
      score: 100,
      verdict: "accepted",
      feedback: "great",
    });
    expect(mapped.customScore).toBe(100);
    expect(mapped.scoringFeedback).toBe("great");
    expect(mapped.testcaseResults).toHaveLength(1);
    expect(mapped.testcaseResults[0]).toMatchObject({ index: 0, verdict: "AC" });
  });

  it("maps a top-level non-AC verdict onto the synthetic case", () => {
    const mapped = mapAdvancedResult({ score: 0, verdict: "time_limit_exceeded" });
    expect(mapped.testcaseResults[0]?.verdict).toBe("TLE");
    expect(mapped.customScore).toBe(0);
  });

  it("prefers per-case detail when the image reports testcases", () => {
    const mapped = mapAdvancedResult({
      score: 50,
      verdict: "wrong_answer",
      testcases: [
        { index: 0, verdict: "AC", runtimeMs: 12 },
        { index: 1, verdict: "WA", feedback: "off by one" },
      ],
    });
    expect(mapped.testcaseResults).toHaveLength(2);
    expect(mapped.testcaseResults[0]).toMatchObject({ index: 0, verdict: "AC", timeMs: 12 });
    expect(mapped.testcaseResults[1]).toMatchObject({
      index: 1,
      verdict: "WA",
      feedback: "off by one",
    });
    expect(mapped.customScore).toBe(50);
  });

  it("omits scoringFeedback when the image reports none", () => {
    const mapped = mapAdvancedResult({ score: 100, verdict: "accepted" });
    expect(mapped.scoringFeedback).toBeUndefined();
  });
});

describe("resolveAdvancedResult", () => {
  it("collapses a schema-invalid result.json to a single SE case", () => {
    const mapped = resolveAdvancedResult({ score: "high" }, 100);
    expect(mapped.testcaseResults).toHaveLength(1);
    expect(mapped.testcaseResults[0]!.verdict).toBe("SE");
    expect(mapped.testcaseResults[0]!.feedback).toMatch(/^Invalid result\.json: /);
  });

  it("rejects a score above the configured maximum", () => {
    const mapped = resolveAdvancedResult({ score: 150, verdict: "accepted" }, 100);
    expect(mapped.testcaseResults[0]!.verdict).toBe("SE");
  });

  it("maps a valid result", () => {
    expect(resolveAdvancedResult({ score: 100, verdict: "accepted" }, 100).overallVerdict).toBe(
      "AC",
    );
  });
});

describe("ADVANCED_VERDICT_TO_SANDBOX", () => {
  it("maps every advanced verdict onto a sandbox verdict", () => {
    expect(ADVANCED_VERDICT_TO_SANDBOX).toEqual({
      accepted: "AC",
      wrong_answer: "WA",
      time_limit_exceeded: "TLE",
      memory_limit_exceeded: "MLE",
      runtime_error: "RE",
      compile_error: "RE",
    });
  });
});
