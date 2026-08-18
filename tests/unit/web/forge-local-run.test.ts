import { describe, expect, it } from "vitest";

import {
  forgeFiles,
  forgeTerminationVerdict,
  mapForgeRunResult,
  supportsForgeLocalRun,
} from "$lib/services/forge-local-run";
import type { RunResult } from "@wasm-oj/forge/browser";

function forgeRun(overrides: Partial<RunResult>): RunResult {
  return {
    code: 0,
    stdout: "",
    stderr: "",
    files: {},
    durationMs: 12.4,
    determinism: { randomSeed: 1, realtimeEpochMs: 0, clockStepNs: 1_000_000 },
    resources: {
      instructionBudget: 1,
      logicalTimeLimitMs: 1_000,
      memoryLimitBytes: 16 * 1024 * 1024,
      outputLimitBytes: 1_000_000,
      filesystemWriteLimitBytes: 64 * 1024 * 1024,
      filesystemEntryLimit: 4096,
      wallTimeLimitMs: 3_000,
    },
    termination: "exited",
    metrics: {
      cost: 1,
      rawCost: 1,
      baselineCost: 0,
      costProfile: "test",
      costModel: "weighted",
      operations: null,
      memoryBytes: 2_048,
      logicalTimeNs: 1,
      filesystemBytes: 0,
      filesystemEntries: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
    },
    ...overrides,
  };
}

describe("Forge local run result mapping", () => {
  it("accepts Forge languages but leaves Java on the existing path", () => {
    expect(supportsForgeLocalRun("cpp")).toBe(true);
    expect(supportsForgeLocalRun("typescript")).toBe(true);
    expect(supportsForgeLocalRun("java")).toBe(false);
  });

  it("preserves visible multi-file workspace paths", () => {
    expect(
      forgeFiles({
        context: { type: "practice" },
        language: "cpp",
        problemId: "problem_1",
        sourceCode: "int main() {}",
        sourceFiles: [
          { path: "main.cpp", content: "int main() {}" },
          { path: "include/value.hpp", content: "#pragma once" },
        ],
      }),
    ).toEqual({
      entry: "main.cpp",
      files: {
        "main.cpp": "int main() {}",
        "include/value.hpp": "#pragma once",
      },
    });
  });

  it("maps resource termination to NOJV verdicts", () => {
    expect(forgeTerminationVerdict("logical-time-limit", 0)).toBe("TLE");
    expect(forgeTerminationVerdict("wall-time-limit", 0)).toBe("TLE");
    expect(forgeTerminationVerdict("memory-limit", 0)).toBe("MLE");
    expect(forgeTerminationVerdict("trap", 0)).toBe("RE");
  });

  it("reuses the standard token comparator", () => {
    const result = mapForgeRunResult(
      forgeRun({ stdout: "1  2\n" }),
      "1 2",
      { caseSensitive: true, floatTolerance: null },
      2,
    );

    expect(result).toMatchObject({ index: 2, verdict: "AC", timeMs: 12, memoryKb: 2 });
  });

  it("keeps wrong answers and non-zero exits distinct", () => {
    expect(
      mapForgeRunResult(forgeRun({ stdout: "wrong" }), "right", undefined, 0).verdict,
    ).toBe("WA");
    expect(mapForgeRunResult(forgeRun({ code: 1 }), undefined, undefined, 1).verdict).toBe(
      "RE",
    );
  });
});
