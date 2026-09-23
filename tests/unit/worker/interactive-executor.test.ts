import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  INTERACTIVE_RUN_MARKER,
  INTERACTIVE_VALIDATE_MARKER,
  type SandboxRequest,
  type SandboxTestcase,
} from "@nojv/core";

import {
  resolveInteractiveStage,
  type InteractiveSideResult,
} from "../../../apps/worker/src/services/check-interactive";
import {
  writeInteractorFiles,
  writeSolutionFiles,
} from "../../../apps/worker/src/services/interactive-executor";

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

const TESTCASE: SandboxTestcase = {
  index: 2,
  input: "secret 7\n",
  output: "answer 7\n",
  weight: 1,
  isSample: false,
};

function runStderr(report: Record<string, unknown>): string {
  return `some log\n${INTERACTIVE_RUN_MARKER}${JSON.stringify({ index: 2, ...report })}\n`;
}

function intStderr(outcome: Record<string, unknown>): string {
  return `${INTERACTIVE_VALIDATE_MARKER}${JSON.stringify({ index: 2, ...outcome })}\n`;
}

function merge(sol: InteractiveSideResult, int: InteractiveSideResult) {
  const result = resolveInteractiveStage([TESTCASE], sol, int).testcaseResults[0];
  if (!result) throw new Error("no merged result");
  return result;
}

describe("resolveInteractiveStage", () => {
  const ok = { stderr: "", timedOut: false, spawnError: false };

  it("uses the interactor verdict (AC) and teamMessage when the run is clean", () => {
    const result = merge(
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 12, errorVerdict: null }) },
      { ...ok, stderr: intStderr({ verdict: "AC", teamMessage: "solved in 4" }) },
    );
    expect(result.verdict).toBe("AC");
    expect(result.feedback).toBe("solved in 4");
    expect(result.index).toBe(2);
    expect(result.timeMs).toBe(12);
  });

  it("a run error verdict (TLE) wins over the interactor outcome", () => {
    const result = merge(
      { ...ok, stderr: runStderr({ exitCode: -1, timeMs: 6000, errorVerdict: "TLE" }) },
      { ...ok, stderr: intStderr({ verdict: "AC" }) },
    );
    expect(result.verdict).toBe("TLE");
  });

  it("renders a WA verdict from the interactor", () => {
    const result = merge(
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      { ...ok, stderr: intStderr({ verdict: "WA" }) },
    );
    expect(result.verdict).toBe("WA");
  });

  it("surfaces the interactor judgeMessage as staffFeedback (not the student feedback)", () => {
    const result = merge(
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      {
        ...ok,
        stderr: intStderr({
          verdict: "WA",
          teamMessage: "wrong guess",
          judgeMessage: "secret answer was 7",
        }),
      },
    );
    expect(result.feedback).toBe("wrong guess");
    expect(result.staffFeedback).toBe("secret answer was 7");
    expect(JSON.stringify(result)).not.toContain("judgeMessage");
  });

  it("omits staffFeedback when the interactor did not emit judgeMessage", () => {
    const result = merge(
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      { ...ok, stderr: intStderr({ verdict: "AC", teamMessage: "good" }) },
    );
    expect(result.feedback).toBe("good");
    expect(result).not.toHaveProperty("staffFeedback");
  });

  it("a missing run marker → SE", () => {
    const result = merge(
      { ...ok, stderr: "no marker" },
      { ...ok, stderr: intStderr({ verdict: "AC" }) },
    );
    expect(result.verdict).toBe("SE");
  });

  it("a clean run but missing interactor marker → SE", () => {
    const result = merge(
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      { ...ok, stderr: "interactor crashed silently" },
    );
    expect(result.verdict).toBe("SE");
  });

  it("an interactor SE outcome → SE for the case", () => {
    const result = merge(
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      {
        ...ok,
        stderr: intStderr({ verdict: "SE", judgeMessage: "ValueError: invalid secret" }),
      },
    );
    expect(result.verdict).toBe("SE");
    expect(result.feedback).toBe("Interactive judge failed; this submission was not counted.");
    expect(result.staffFeedback).toBe("ValueError: invalid secret");
  });

  it("does not turn an interactor crash into a solution runtime error", () => {
    const result = merge(
      { ...ok, stderr: runStderr({ exitCode: 1, timeMs: 5, errorVerdict: "RE" }) },
      {
        ...ok,
        stderr: intStderr({ verdict: "SE", judgeMessage: "ValueError: invalid secret" }),
      },
    );

    expect(result.verdict).toBe("SE");
    expect(result.staffFeedback).toBe("ValueError: invalid secret");
  });

  it("a container timeout → SE", () => {
    const result = merge(
      { stderr: "", timedOut: true, spawnError: false },
      { stderr: "", timedOut: true, spawnError: false },
    );
    expect(result.verdict).toBe("SE");
  });

  it("a solution spawn error → SE", () => {
    const result = merge(
      { stderr: "spawn failed", timedOut: false, spawnError: true },
      { ...ok, stderr: intStderr({ verdict: "AC" }) },
    );
    expect(result.verdict).toBe("SE");
  });

  it("matches reports to cases by index and turns a protocol violation into WA", () => {
    const second = { ...TESTCASE, index: 5 };
    const results = resolveInteractiveStage(
      [TESTCASE, second],
      {
        stderr: `${INTERACTIVE_RUN_MARKER}{"index":2,"exitCode":0,"timeMs":4}\n`,
        timedOut: false,
        spawnError: false,
      },
      {
        stderr: [
          `${INTERACTIVE_VALIDATE_MARKER}{"index":2,"verdict":"AC"}`,
          `${INTERACTIVE_VALIDATE_MARKER}{"index":5,"verdict":"WA","judgeMessage":"Interactive protocol violation"}`,
        ].join("\n"),
        timedOut: false,
        spawnError: false,
      },
    ).testcaseResults;
    expect(results.map((result) => [result.index, result.verdict])).toEqual([
      [2, "AC"],
      [5, "WA"],
    ]);
  });

  it("returns the solution compile error for the whole stage", () => {
    const result = resolveInteractiveStage(
      [TESTCASE],
      {
        stderr: runStderr({ exitCode: -1, timeMs: 0, compilationError: "main.c: error" }),
        timedOut: false,
        spawnError: false,
      },
      { stderr: "", timedOut: false, spawnError: false },
    );
    expect(result).toEqual({ testcaseResults: [], compilationError: "main.c: error" });
  });
});

describe("interactive container file layout", () => {
  let solDir: string;
  let intDir: string;

  const request: SandboxRequest = {
    submissionId: "sub-int",
    sourceCode: "print('hi')\n",
    language: "python",
    problemType: "full_source",
    testcases: [TESTCASE],
    judgeType: "interactive",
    judgeConfig: { interactorScript: "accept()\n", interactorLanguage: "python" },
    limits: { timeoutMs: 2_000, memoryMb: 256 },
  };

  beforeEach(async () => {
    solDir = await mkdtemp(join(tmpdir(), "isol-"));
    intDir = await mkdtemp(join(tmpdir(), "iint-"));
  });

  afterEach(async () => {
    await Promise.all([
      rm(solDir, { recursive: true, force: true }),
      rm(intDir, { recursive: true, force: true }),
    ]);
  });

  it("solution container holds source + config(role=solution) and NO secret", async () => {
    await writeSolutionFiles(solDir, {
      ...request,
      sourceFiles: [{ path: "config.json", content: "workspace asset" }],
    });
    const config = JSON.parse(await readFile(join(solDir, "config.json"), "utf8"));
    const sourceMap = config.sourceFileMap as { path: string; key: string }[];
    for (const [path, content] of [
      ["main.py", request.sourceCode],
      ["config.json", "workspace asset"],
    ]) {
      const key = sourceMap.find((entry) => entry.path === path)!.key;
      expect(await readFile(join(solDir, key), "utf8")).toBe(content);
    }
    expect(config.interactive).toEqual({ role: "solution", cases: [2] });
    expect(await exists(join(solDir, "cases"))).toBe(false);
    expect(await exists(join(solDir, "interactor.py"))).toBe(false);
  });

  it("interactor container holds interactor + the secret input/answer", async () => {
    await writeInteractorFiles(intDir, request, "accept()\n", "python");
    expect(await readFile(join(intDir, "interactor.py"), "utf8")).toBe("accept()\n");
    expect(await readFile(join(intDir, "case-2-input.txt"), "utf8")).toBe("secret 7\n");
    expect(await readFile(join(intDir, "case-2-answer.txt"), "utf8")).toBe("answer 7\n");
    const config = JSON.parse(await readFile(join(intDir, "config.json"), "utf8"));
    expect(config.interactive).toEqual({ role: "validator", language: "python", cases: [2] });
    expect(await exists(join(intDir, "main.py"))).toBe(false);
  });
});
