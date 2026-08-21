import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import type { SandboxResult } from "@nojv/core";

const { mapResult } = submissionDomain;

const NO_ADJUSTMENT = {
  adjustment: {
    assignmentAdjustmentRules: null,
    dueAt: null,
    finalDay: null,
    submittedAt: new Date(),
  },
  compareOptions: null,
};

describe("mapResult — runtime diagnostics", () => {
  it("promotes the testcase runtime diagnostic to top-level feedback", () => {
    const sandbox: SandboxResult = {
      testcaseResults: [
        {
          index: 0,
          verdict: "RE",
          stdout: "",
          stderr: "ValueError: invalid input",
          exitCode: 1,
          timeMs: 4,
          feedback: "ValueError: invalid input",
        },
      ],
    };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result).toMatchObject({
      verdict: "runtime_error",
      feedback: "ValueError: invalid input",
    });
  });
});
