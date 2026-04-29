import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/domain";
import type { SandboxResult, SandboxTestcaseResult, SandboxVerdict } from "@nojv/core";

const { buildSubtaskResults } = submissionDomain;

// Local re-types so we don't depend on a deep subpath import that the
// repo's path alias doesn't expose. These shapes mirror the exported
// `TestcaseSetGroup` / `SubtaskStrategyMap` from `@nojv/domain`.
type SubtaskStrategyMap = Record<string, "ALL_OR_NOTHING" | "PROPORTIONAL" | "MINIMUM">;
interface TestcaseSetGroup {
  id: string;
  name: string;
  testcases: { id: string; input: string; output?: string; weight: number }[];
  weight: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — keep test bodies focused on the rule under inspection.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────

describe("buildSubtaskResults", () => {
  describe("ALL_OR_NOTHING (default)", () => {
    it("awards full weight when every testcase in the subtask is AC", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3"], 100)];
      const strategies: SubtaskStrategyMap = { s1: "ALL_OR_NOTHING" };
      const result = buildSubtaskResults(mkSandbox(["AC", "AC", "AC"]), sets, strategies);

      expect(result).toHaveLength(1);
      expect(result[0]!.passed).toBe(true);
      expect(result[0]!.rawScore).toBe(100);
      expect(result[0]!.cases.map((c) => c.verdict)).toEqual(["AC", "AC", "AC"]);
    });

    it("zeroes the entire subtask when one testcase is WA (IOI/contest rule)", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3"], 100)];
      const strategies: SubtaskStrategyMap = { s1: "ALL_OR_NOTHING" };
      const result = buildSubtaskResults(mkSandbox(["AC", "WA", "AC"]), sets, strategies);

      expect(result[0]!.passed).toBe(false);
      expect(result[0]!.rawScore).toBe(0);
    });

    it("falls back to ALL_OR_NOTHING when strategy map has no entry for the subtask", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2"], 50)];
      // empty strategies map → default
      const result = buildSubtaskResults(mkSandbox(["AC", "WA"]), sets, {});

      expect(result[0]!.rawScore).toBe(0);
    });
  });

  describe("PROPORTIONAL", () => {
    it("awards weight * (passed / total) for partial AC", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3", "t4"], 100)];
      const strategies: SubtaskStrategyMap = { s1: "PROPORTIONAL" };
      // 3/4 passed
      const result = buildSubtaskResults(mkSandbox(["AC", "AC", "AC", "WA"]), sets, strategies);
      expect(result[0]!.rawScore).toBe(75);
      expect(result[0]!.passed).toBe(false); // not all passed
    });

    it("returns full weight when every case passes under PROPORTIONAL", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2"], 80)];
      const strategies: SubtaskStrategyMap = { s1: "PROPORTIONAL" };
      const result = buildSubtaskResults(mkSandbox(["AC", "AC"]), sets, strategies);
      expect(result[0]!.rawScore).toBe(80);
      expect(result[0]!.passed).toBe(true);
    });

    it("returns 0 when no cases pass under PROPORTIONAL", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2"], 80)];
      const strategies: SubtaskStrategyMap = { s1: "PROPORTIONAL" };
      const result = buildSubtaskResults(mkSandbox(["WA", "WA"]), sets, strategies);
      expect(result[0]!.rawScore).toBe(0);
    });
  });

  describe("MINIMUM (collapses to ALL_OR_NOTHING per code comment)", () => {
    it("behaves like ALL_OR_NOTHING — partial pass scores 0", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2"], 60)];
      const strategies: SubtaskStrategyMap = { s1: "MINIMUM" };
      const result = buildSubtaskResults(mkSandbox(["AC", "WA"]), sets, strategies);
      expect(result[0]!.rawScore).toBe(0);
    });

    it("awards full weight when all cases pass under MINIMUM", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2"], 60)];
      const strategies: SubtaskStrategyMap = { s1: "MINIMUM" };
      const result = buildSubtaskResults(mkSandbox(["AC", "AC"]), sets, strategies);
      expect(result[0]!.rawScore).toBe(60);
      expect(result[0]!.passed).toBe(true);
    });
  });

  describe("verdict mapping & per-case shape", () => {
    it("preserves TLE / MLE / RE / OLE-as-RE verdicts on the case payload", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3", "t4"])];
      // Sandbox uses "RE" for both runtime and OLE; MapResult-level mapping
      // is exercised separately. Here we just confirm verdict strings are
      // copied through onto each case.
      const result = buildSubtaskResults(mkSandbox(["TLE", "MLE", "RE", "RE"]), sets, {
        s1: "ALL_OR_NOTHING",
      });
      expect(result[0]!.cases.map((c) => c.verdict)).toEqual(["TLE", "MLE", "RE", "RE"]);
      expect(result[0]!.passed).toBe(false);
      expect(result[0]!.rawScore).toBe(0);
    });

    it("falls back to verdict 'SE' when the sandbox is missing a case slot", () => {
      // Set declares 3 testcases but sandbox only returned 2 — undefined slot.
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2", "t3"])];
      const partial: SandboxResult = {
        testcaseResults: [mkCase(0, "AC"), mkCase(1, "AC")],
      };
      const result = buildSubtaskResults(partial, sets, { s1: "ALL_OR_NOTHING" });
      expect(result[0]!.cases.map((c) => c.verdict)).toEqual(["AC", "AC", "SE"]);
      expect(result[0]!.passed).toBe(false);
    });

    it("uses the per-case runtimeMs from the sandbox payload", () => {
      const sets = [mkSet("s1", "Subtask 1", ["t1", "t2"])];
      const sandbox: SandboxResult = {
        testcaseResults: [mkCase(0, "AC", 12), mkCase(1, "AC", 34)],
      };
      const result = buildSubtaskResults(sandbox, sets, { s1: "ALL_OR_NOTHING" });
      expect(result[0]!.cases.map((c) => c.runtimeMs)).toEqual([12, 34]);
    });

    it("links each case to its testcaseId in subtask order", () => {
      const sets = [mkSet("s1", "Subtask 1", ["alpha", "beta"])];
      const result = buildSubtaskResults(mkSandbox(["AC", "WA"]), sets, {
        s1: "ALL_OR_NOTHING",
      });
      expect(result[0]!.cases.map((c) => c.testcaseId)).toEqual(["alpha", "beta"]);
    });
  });

  describe("multiple subtasks", () => {
    it("walks the flat sandbox case array in subtask declaration order", () => {
      const sets = [
        mkSet("s1", "S1", ["t1", "t2"], 30),
        mkSet("s2", "S2", ["t3", "t4", "t5"], 70),
      ];
      // s1 = AC,AC (full pass) ; s2 = AC,WA,AC (one fail)
      const result = buildSubtaskResults(mkSandbox(["AC", "AC", "AC", "WA", "AC"]), sets, {
        s1: "ALL_OR_NOTHING",
        s2: "ALL_OR_NOTHING",
      });

      expect(result).toHaveLength(2);
      expect(result[0]!.label).toBe("S1");
      expect(result[0]!.rawScore).toBe(30);
      expect(result[0]!.passed).toBe(true);

      expect(result[1]!.label).toBe("S2");
      expect(result[1]!.rawScore).toBe(0); // WA in s2 → all-or-nothing zero
      expect(result[1]!.passed).toBe(false);
    });

    it("sums fractional PROPORTIONAL scores correctly across multiple subtasks", () => {
      const sets = [
        mkSet("s1", "S1", ["t1", "t2"], 40), // 1/2 pass = 20
        mkSet("s2", "S2", ["t3", "t4", "t5", "t6"], 60), // 3/4 pass = 45
      ];
      const result = buildSubtaskResults(
        mkSandbox(["AC", "WA", "AC", "AC", "AC", "WA"]),
        sets,
        { s1: "PROPORTIONAL", s2: "PROPORTIONAL" },
      );
      expect(result[0]!.rawScore).toBe(20);
      expect(result[1]!.rawScore).toBe(45);
      const sum = result.reduce((s, r) => s + r.rawScore, 0);
      expect(sum).toBe(65);
    });

    it("subtasks with different strategies do not contaminate each other", () => {
      const sets = [
        mkSet("s1", "S1", ["t1", "t2"], 50), // ALL_OR_NOTHING + 1 WA → 0
        mkSet("s2", "S2", ["t3", "t4"], 50), // PROPORTIONAL + 1/2 → 25
      ];
      const result = buildSubtaskResults(mkSandbox(["AC", "WA", "AC", "WA"]), sets, {
        s1: "ALL_OR_NOTHING",
        s2: "PROPORTIONAL",
      });
      expect(result[0]!.rawScore).toBe(0);
      expect(result[1]!.rawScore).toBe(25);
    });
  });

  describe("empty subtask (0 testcases)", () => {
    // Pinning current behavior: an empty subtask is treated as "did not pass"
    // (rawScore 0, passed false). If product wants to flip this to "vacuously
    // pass" we'd update the test together with the implementation.
    it("returns rawScore=0 and passed=false for a subtask with no testcases", () => {
      const sets = [mkSet("s_empty", "Empty", [], 50)];
      const result = buildSubtaskResults({ testcaseResults: [] }, sets, {
        s_empty: "ALL_OR_NOTHING",
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.rawScore).toBe(0);
      expect(result[0]!.passed).toBe(false);
      expect(result[0]!.cases).toEqual([]);
    });

    it("empty subtask under PROPORTIONAL also returns 0 (avoids 0/0 NaN)", () => {
      const sets = [mkSet("s_empty", "Empty", [], 50)];
      const result = buildSubtaskResults({ testcaseResults: [] }, sets, {
        s_empty: "PROPORTIONAL",
      });
      expect(result[0]!.rawScore).toBe(0);
      expect(Number.isNaN(result[0]!.rawScore)).toBe(false);
    });
  });
});
