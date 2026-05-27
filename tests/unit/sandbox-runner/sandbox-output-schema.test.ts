import { describe, expect, it } from "vitest";

import { SandboxOutputSchema } from "../../../apps/sandbox-runner/src/types.js";

describe("SandboxOutputSchema", () => {
  it("parses a testcaseResults payload", () => {
    const parsed = SandboxOutputSchema.safeParse({
      testcaseResults: [
        { index: 0, verdict: "AC", stdout: "ok", stderr: "", exitCode: 0, timeMs: 5 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("parses a rawRuns payload", () => {
    const parsed = SandboxOutputSchema.safeParse({
      rawRuns: [{ index: 0, stdout: "42\n", stderr: "", exitCode: 0, timeMs: 3 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a rawRun carrying an errorVerdict", () => {
    const parsed = SandboxOutputSchema.safeParse({
      rawRuns: [{ index: 1, stdout: "", stderr: "boom", exitCode: 1, timeMs: 2, errorVerdict: "RE" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an AC/WA errorVerdict on a rawRun", () => {
    const parsed = SandboxOutputSchema.safeParse({
      rawRuns: [{ index: 0, stdout: "", stderr: "", exitCode: 0, timeMs: 1, errorVerdict: "AC" }],
    });
    expect(parsed.success).toBe(false);
  });
});
