import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import { submissionResultSchema, type SandboxResult } from "@nojv/core";

const { mapResult } = submissionDomain;

const NO_ADJUSTMENT = {
  adjustment: { adjustmentRules: null, dueAt: null, submittedAt: new Date() },
  compareOptions: null,
};

const sets = [
  {
    id: "samples",
    name: "samples",
    weight: 0,
    testcases: [{ id: "s1", input: "1", weight: 0 }],
  },
  { id: "main", name: "main", weight: 100, testcases: [{ id: "m1", input: "2", weight: 100 }] },
];

function sandbox(sampleVerdict: string): SandboxResult {
  return {
    testcaseResults: [
      { index: 0, verdict: sampleVerdict, stdout: "", stderr: "", exitCode: 0, timeMs: 1 },
      { index: 1, verdict: "AC", stdout: "", stderr: "", exitCode: 0, timeMs: 1 },
    ],
  } as SandboxResult;
}

describe("mapResult — 0-point subtasks", () => {
  it("judges a 0-point set without adding to the score or the maximum", () => {
    const result = mapResult(sandbox("AC"), sets, NO_ADJUSTMENT as never);

    expect(result).toMatchObject({ verdict: "accepted", accepted: true, score: 100 });
    expect(result.subtaskResults?.map(({ weight, rawScore }) => [weight, rawScore])).toEqual([
      [0, 0],
      [100, 100],
    ]);
    expect(() => submissionResultSchema.parse(result)).not.toThrow();
  });

  it("reports a failing 0-point set in the verdict while keeping the earned score", () => {
    const result = mapResult(sandbox("WA"), sets, NO_ADJUSTMENT as never);

    expect(result).toMatchObject({ verdict: "wrong_answer", accepted: false, score: 100 });
    expect(() => submissionResultSchema.parse(result)).not.toThrow();
  });
});
