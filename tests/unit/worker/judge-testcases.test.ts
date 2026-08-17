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
});
