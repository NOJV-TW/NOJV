import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import { submissionResultSchema } from "@nojv/core";
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

describe("mapResult — empty testcase set is never silently Accepted", () => {
  it("maps zero testcase results to system_error (not accepted), score 0", () => {
    const sandbox: SandboxResult = { testcaseResults: [] };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(result.verdict).toBe("system_error");
    expect(result.accepted).toBe(false);
    expect(result.score).toBe(0);
  });

  it("empty-result system_error passes submissionResultSchema", () => {
    const sandbox: SandboxResult = { testcaseResults: [] };

    const result = mapResult(sandbox, [], NO_ADJUSTMENT as never);

    expect(() => submissionResultSchema.parse(result)).not.toThrow();
  });
});
