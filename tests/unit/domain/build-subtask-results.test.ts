import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";
import type { SandboxResult, SandboxTestcaseResult, SandboxVerdict } from "@nojv/core";

const { buildSubtaskResults } = submissionDomain;

interface TestcaseSetGroup {
  id: string;
  name: string;
  testcases: { id: string; input: string; output?: string; weight: number }[];
  weight: number;
}

function mkCase(index: number, verdict: SandboxVerdict, timeMs = 5): SandboxTestcaseResult {
  return {
    index,
    verdict,
    stdout: "",
    stderr: "",
    exitCode: verdict === "AC" ? 0 : 1,
    timeMs,
  };
}

function mkSandbox(verdicts: SandboxVerdict[]): SandboxResult {
  return {
    testcaseResults: verdicts.map((v, i) => mkCase(i, v)),
  };
}

function mkSet(
  id: string,
  name: string,
  testcaseIds: string[],
  weight = 100,
): TestcaseSetGroup {
  return {
    id,
    name,
    weight,
    testcases: testcaseIds.map((tid) => ({
      id: tid,
      input: "",
      output: "",
      weight,
    })),
  };
}

describe("buildSubtaskResults — all-or-nothing only (no per-subset partial scoring)", () => {
  describe("single subtask", () => {
    it("awards full weight when every testcase in the subtask is AC", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3"], 100)];
      const result = buildSubtaskResults(mkSandbox(["AC", "AC", "AC"]), sets);

      expect(result).toHaveLength(1);
      expect(result[0]!.passed).toBe(true);
      expect(result[0]!.rawScore).toBe(100);
      expect(result[0]!.cases.map((c) => c.verdict)).toEqual(["AC", "AC", "AC"]);
    });

    it("zeroes the entire subtask when any one testcase is not AC", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3"], 100)];
      expect(buildSubtaskResults(mkSandbox(["AC", "WA", "AC"]), sets)[0]!.rawScore).toBe(0);
      expect(buildSubtaskResults(mkSandbox(["AC", "TLE", "AC"]), sets)[0]!.rawScore).toBe(0);
      expect(buildSubtaskResults(mkSandbox(["RE", "AC", "AC"]), sets)[0]!.rawScore).toBe(0);
    });

    it("marks passed=false whenever rawScore is zeroed", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2"], 50)];
      const result = buildSubtaskResults(mkSandbox(["AC", "WA"]), sets);
      expect(result[0]!.rawScore).toBe(0);
      expect(result[0]!.passed).toBe(false);
    });
  });

  describe("verdict mapping & per-case shape", () => {
    it("preserves TLE / MLE / RE verdicts on the case payload", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3", "t4"])];
      const result = buildSubtaskResults(mkSandbox(["TLE", "MLE", "RE", "RE"]), sets);
      expect(result[0]!.cases.map((c) => c.verdict)).toEqual(["TLE", "MLE", "RE", "RE"]);
      expect(result[0]!.passed).toBe(false);
      expect(result[0]!.rawScore).toBe(0);
    });

    it("falls back to verdict 'SE' when the sandbox is missing a case slot", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3"])];
      const partial: SandboxResult = {
        testcaseResults: [mkCase(0, "AC"), mkCase(1, "AC")],
      };
      const result = buildSubtaskResults(partial, sets);
      expect(result[0]!.cases.map((c) => c.verdict)).toEqual(["AC", "AC", "SE"]);
      expect(result[0]!.passed).toBe(false);
      expect(result[0]!.rawScore).toBe(0);
    });

    it("uses the per-case timeMs from the sandbox payload", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2"])];
      const sandbox: SandboxResult = {
        testcaseResults: [mkCase(0, "AC", 12), mkCase(1, "AC", 34)],
      };
      const result = buildSubtaskResults(sandbox, sets);
      expect(result[0]!.cases.map((c) => c.timeMs)).toEqual([12, 34]);
    });

    it("links each case to its testcaseId in subtask order", () => {
      const sets = [mkSet("s1", "Subtask 1", ["alpha", "beta"])];
      const result = buildSubtaskResults(mkSandbox(["AC", "WA"]), sets);
      expect(result[0]!.cases.map((c) => c.testcaseId)).toEqual(["alpha", "beta"]);
    });
  });

  describe("multiple subtasks", () => {
    it("walks the flat sandbox case array in subtask declaration order", () => {
      const sets = [
        mkSet("s1", "S1", ["t1", "t2"], 30),
        mkSet("s2", "S2", ["t3", "t4", "t5"], 70),
      ];
      const result = buildSubtaskResults(mkSandbox(["AC", "AC", "AC", "WA", "AC"]), sets);

      expect(result).toHaveLength(2);
      expect(result[0]!.label).toBe("S1");
      expect(result[0]!.rawScore).toBe(30);
      expect(result[0]!.passed).toBe(true);

      expect(result[1]!.label).toBe("S2");
      expect(result[1]!.rawScore).toBe(0);
      expect(result[1]!.passed).toBe(false);
    });

    it("scores each subtask independently — one failing subtask does not affect a passing one", () => {
      const sets = [mkSet("s1", "S1", ["t1", "t2"], 50), mkSet("s2", "S2", ["t3", "t4"], 50)];
      const result = buildSubtaskResults(mkSandbox(["AC", "AC", "AC", "WA"]), sets);
      expect(result[0]!.rawScore).toBe(50);
      expect(result[1]!.rawScore).toBe(0);
    });
  });

  describe("empty subtask (0 testcases)", () => {
    it("returns rawScore=0 and passed=false for a subtask with no testcases", () => {
      const sets = [mkSet("s_empty", "Empty", [], 50)];
      const result = buildSubtaskResults({ testcaseResults: [] }, sets);
      expect(result).toHaveLength(1);
      expect(result[0]!.rawScore).toBe(0);
      expect(result[0]!.passed).toBe(false);
      expect(result[0]!.cases).toEqual([]);
    });
  });
});
