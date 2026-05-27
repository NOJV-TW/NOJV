import { describe, expect, it } from "vitest";

import type { RunProcessResult } from "../../../apps/sandbox-runner/src/judges/run-process.js";
import { toRawCaseRun } from "../../../apps/sandbox-runner/src/judges/standard.js";

function makeResult(overrides: Partial<RunProcessResult>): RunProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    timeMs: 5,
    memoryKb: 0,
    timedOut: false,
    signal: null,
    spawnError: false,
    ...overrides,
  };
}

describe("toRawCaseRun", () => {
  it("leaves errorVerdict unset on a clean run", () => {
    const run = toRawCaseRun(makeResult({ stdout: "42\n", exitCode: 0 }), 0);
    expect(run.errorVerdict).toBeUndefined();
    expect(run.stdout).toBe("42\n");
    expect(run.index).toBe(0);
  });

  it("sets TLE when the run timed out", () => {
    expect(toRawCaseRun(makeResult({ timedOut: true }), 1).errorVerdict).toBe("TLE");
  });

  it("sets MLE when the run was SIGKILLed", () => {
    expect(toRawCaseRun(makeResult({ signal: "SIGKILL" }), 0).errorVerdict).toBe("MLE");
  });

  it("sets RE on a non-zero exit", () => {
    expect(toRawCaseRun(makeResult({ exitCode: 1 }), 0).errorVerdict).toBe("RE");
  });

  it("sets SE on a spawn error", () => {
    expect(toRawCaseRun(makeResult({ spawnError: true }), 0).errorVerdict).toBe("SE");
  });

  it("includes memoryKb only when measured", () => {
    expect(toRawCaseRun(makeResult({ memoryKb: 0 }), 0).memoryKb).toBeUndefined();
    expect(toRawCaseRun(makeResult({ memoryKb: 1024 }), 0).memoryKb).toBe(1024);
  });
});
