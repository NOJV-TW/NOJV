import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import { submissionResultSchema } from "@nojv/core";

const { deriveVerdictSummary } = submissionDomain;

const partialResult = {
  accepted: false,
  verdict: "wrong_answer" as const,
  score: 75,
  runtimeMs: 10,
  feedback: "partial",
  caseResults: [],
  subtaskResults: [
    { cases: [], label: "S1", passed: false, rawScore: 75, testcaseSetId: "s1", weight: 100 },
  ],
};

describe("subtask partial score (PROPORTIONAL/MINIMUM) survives schema + summary", () => {
  it("submissionResultSchema preserves rawScore instead of stripping it", () => {
    const parsed = submissionResultSchema.parse(partialResult);
    expect(parsed.subtaskResults![0]!.rawScore).toBe(75);
  });

  it("deriveVerdictSummary reports the partial subtask score, not binary 0", () => {
    const parsed = submissionResultSchema.parse(partialResult);
    const summary = deriveVerdictSummary(parsed);
    expect(summary.subtaskSummary![0]!.score).toBe(75);
  });
});
