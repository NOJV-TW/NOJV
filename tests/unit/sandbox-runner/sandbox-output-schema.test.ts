import { describe, expect, it } from "vitest";

import { sandboxOutputSchema, compileOutputSchema, validateOutputSchema } from "@nojv/core";
import { parseSandboxResult } from "../../../apps/worker/src/services/sandbox-schema";
import { SandboxOutputSchema } from "../../../apps/sandbox-runner/src/types.js";

describe("SandboxOutputSchema", () => {
  it("uses one producer and consumer contract, including operator diagnostics", () => {
    expect(SandboxOutputSchema).toBe(sandboxOutputSchema);
    const payload = {
      testcaseResults: [
        {
          index: 0,
          verdict: "SE",
          stdout: "",
          stderr: "",
          exitCode: -1,
          timeMs: 0,
          staffFeedback: "internal failure",
        },
      ],
    };
    expect(parseSandboxResult(payload)).toEqual(SandboxOutputSchema.safeParse(payload));
    expect(SandboxOutputSchema.parse(payload).testcaseResults[0]!.staffFeedback).toBe(
      "internal failure",
    );
  });

  it("preserves the invalid field path in worker parse errors", () => {
    const parsed = parseSandboxResult({ rawRuns: [{ index: "invalid" }] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]!.path).toEqual(["rawRuns", 0, "index"]);
  });

  it("accepts explicit failure output and rejects empty output contracts", () => {
    expect(
      SandboxOutputSchema.parse({ pipelineError: "missing case file" }).pipelineError,
    ).toBe("missing case file");
    for (const schema of [sandboxOutputSchema, compileOutputSchema, validateOutputSchema]) {
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

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
      rawRuns: [
        { index: 1, stdout: "", stderr: "boom", exitCode: 1, timeMs: 2, errorVerdict: "RE" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an AC/WA errorVerdict on a rawRun", () => {
    const parsed = SandboxOutputSchema.safeParse({
      rawRuns: [
        { index: 0, stdout: "", stderr: "", exitCode: 0, timeMs: 1, errorVerdict: "AC" },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
