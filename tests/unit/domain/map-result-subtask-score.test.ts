import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import type { SandboxResult, SandboxTestcaseResult, SandboxVerdict } from "@nojv/core";

const { mapResult } = submissionDomain;

interface TestcaseSetGroup {
  id: string;
  name: string;
  testcases: { id: string; input: string; output?: string; weight: number }[];
  weight: number;
}

function mkCase(index: number, verdict: SandboxVerdict): SandboxTestcaseResult {
  return {
    index,
    verdict,
    stdout: "",
    stderr: "",
    exitCode: verdict === "AC" ? 0 : 1,
    timeMs: 1,
  };
}

function mkSandbox(verdicts: SandboxVerdict[]): SandboxResult {
  return { testcaseResults: verdicts.map((v, i) => mkCase(i, v)) };
}

function mkSet(
  id: string,
  name: string,
  testcaseIds: string[],
  weight: number,
): TestcaseSetGroup {
  return {
    id,
    name,
    weight,
    testcases: testcaseIds.map((tid) => ({ id: tid, input: "", output: "", weight })),
  };
}

const NO_ADJUSTMENT = {
  adjustment: {
    assignmentAdjustmentRules: null,
    dueAt: null,
    finalDay: null,
    submittedAt: new Date(),
  },
  compareOptions: null,
};

describe("mapResult — score is the sum of passed subtask weights (no 0–100 normalization)", () => {
  const sets = [
    mkSet("s1", "Subtask 1", ["t1", "t2"], 80),
    mkSet("s2", "Subtask 2", ["t3", "t4"], 120),
  ];

  it("full pass on a 80+120 problem scores the real total of 200", () => {
    const result = mapResult(
      mkSandbox(["AC", "AC", "AC", "AC"]),
      sets as never,
      NO_ADJUSTMENT as never,
    );

    expect(result.verdict).toBe("accepted");
    expect(result.accepted).toBe(true);
    expect(result.score).toBe(200);
  });

  it("passing only the first subtask scores that subtask's weight (80), not a percentage", () => {
    const result = mapResult(
      mkSandbox(["AC", "AC", "AC", "WA"]),
      sets as never,
      NO_ADJUSTMENT as never,
    );

    expect(result.verdict).toBe("wrong_answer");
    expect(result.accepted).toBe(false);
    expect(result.score).toBe(80);
  });

  it("passing only the second subtask scores that subtask's weight (120)", () => {
    const result = mapResult(
      mkSandbox(["WA", "AC", "AC", "AC"]),
      sets as never,
      NO_ADJUSTMENT as never,
    );

    expect(result.verdict).toBe("wrong_answer");
    expect(result.accepted).toBe(false);
    expect(result.score).toBe(120);
  });
});
