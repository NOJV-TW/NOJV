import { describe, expect, it } from "vitest";

import type { SubmissionJudgeContext } from "@nojv/application";

import { buildSandboxTestcases } from "../../../apps/worker/src/activities/judge";

describe("buildSandboxTestcases", () => {
  it("uses public testcase inputs for interactive Run instead of transcript samples", () => {
    const context = {
      judgeType: "interactive",
      samples: [{ input: "1 100\nlower\ncorrect", output: "50\n42" }],
      testcaseSets: [
        {
          id: "sample-set",
          name: "sample",
          weight: 1,
          testcases: [{ id: "case-1", input: "42", output: "", weight: 1 }],
        },
      ],
    } as SubmissionJudgeContext;

    expect(
      buildSandboxTestcases(context, {
        useSamples: true,
        useAdvanced: false,
        runCases: [{ input: "1 100\nlower\ncorrect", expectedOutput: "50\n42" }],
        hasRunCases: true,
      }),
    ).toEqual([{ index: 0, input: "42", output: "", weight: 0, isSample: true }]);
  });
  it.each(["standard", "checker"] as const)(
    "prepares %s sample, custom and official stdin consistently",
    (judgeType) => {
      const context = {
        judgeType,
        samples: [{ input: "(())", output: "YES" }],
        testcaseSets: [{ testcases: [{ input: "(())", output: "YES", weight: 1 }] }],
      } as SubmissionJudgeContext;
      for (const mode of ["sample", "custom", "official"]) {
        const cases = buildSandboxTestcases(context, {
          useSamples: mode !== "official",
          useAdvanced: false,
          runCases: mode === "custom" ? [{ input: "(())", expectedOutput: "YES" }] : undefined,
          hasRunCases: mode === "custom",
        });
        expect(cases[0]?.input).toBe("(())");
      }
    },
  );
});
