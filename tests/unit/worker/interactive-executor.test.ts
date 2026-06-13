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
  mergeInteractiveCase,
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
  return `some log\n${INTERACTIVE_RUN_MARKER}${JSON.stringify(report)}\n`;
}

function intStderr(outcome: Record<string, unknown>): string {
  return `${INTERACTIVE_VALIDATE_MARKER}${JSON.stringify(outcome)}\n`;
}

describe("mergeInteractiveCase", () => {
  const ok = { stderr: "", timedOut: false, spawnError: false };

  it("uses the interactor verdict (AC) and teamMessage when the run is clean", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 12, errorVerdict: null }) },
      { ...ok, stderr: intStderr({ verdict: "AC", teamMessage: "solved in 4" }) },
    );
    expect(result.verdict).toBe("AC");
    expect(result.feedback).toBe("solved in 4");
    expect(result.index).toBe(2);
    expect(result.timeMs).toBe(12);
  });

  it("a run error verdict (TLE) wins over the interactor outcome", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
      { ...ok, stderr: runStderr({ exitCode: -1, timeMs: 6000, errorVerdict: "TLE" }) },
      { ...ok, stderr: intStderr({ verdict: "AC" }) },
    );
    expect(result.verdict).toBe("TLE");
  });

  it("renders a WA verdict from the interactor", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      { ...ok, stderr: intStderr({ verdict: "WA" }) },
    );
    expect(result.verdict).toBe("WA");
  });

  it("surfaces the interactor judgeMessage as staffFeedback (not the student feedback)", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
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
    const result = mergeInteractiveCase(
      TESTCASE,
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      { ...ok, stderr: intStderr({ verdict: "AC", teamMessage: "good" }) },
    );
    expect(result.feedback).toBe("good");
    expect(result).not.toHaveProperty("staffFeedback");
  });

  it("a missing run marker → SE", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
      { ...ok, stderr: "no marker" },
      { ...ok, stderr: intStderr({ verdict: "AC" }) },
    );
    expect(result.verdict).toBe("SE");
  });

  it("a clean run but missing interactor marker → SE", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      { ...ok, stderr: "interactor crashed silently" },
    );
    expect(result.verdict).toBe("SE");
  });

  it("an interactor SE outcome → SE for the case", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
      { ...ok, stderr: runStderr({ exitCode: 0, timeMs: 5, errorVerdict: null }) },
      { ...ok, stderr: intStderr({ verdict: "SE", judgeMessage: "interactor error" }) },
    );
    expect(result.verdict).toBe("SE");
  });

  it("a container timeout → SE", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
      { stderr: "", timedOut: true, spawnError: false },
      { stderr: "", timedOut: true, spawnError: false },
    );
    expect(result.verdict).toBe("SE");
  });

  it("a solution spawn error → SE", () => {
    const result = mergeInteractiveCase(
      TESTCASE,
      { stderr: "spawn failed", timedOut: false, spawnError: true },
      { ...ok, stderr: intStderr({ verdict: "AC" }) },
    );
    expect(result.verdict).toBe("SE");
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
    await writeSolutionFiles(solDir, request);
    expect(await readFile(join(solDir, "main.py"), "utf8")).toBe("print('hi')\n");
    const config = JSON.parse(await readFile(join(solDir, "config.json"), "utf8"));
    expect(config.interactive).toEqual({ role: "solution" });
    expect(await exists(join(solDir, "cases"))).toBe(false);
    expect(await exists(join(solDir, "interactor.py"))).toBe(false);
  });

  it("interactor container holds interactor + the secret input/answer", async () => {
    await writeInteractorFiles(intDir, request, TESTCASE, "accept()\n", "python");
    expect(await readFile(join(intDir, "interactor.py"), "utf8")).toBe("accept()\n");
    expect(await readFile(join(intDir, "cases", "2", "input.txt"), "utf8")).toBe("secret 7\n");
    expect(await readFile(join(intDir, "cases", "2", "answer.txt"), "utf8")).toBe("answer 7\n");
    const config = JSON.parse(await readFile(join(intDir, "config.json"), "utf8"));
    expect(config.interactive).toEqual({ role: "validator", language: "python", index: 2 });
    expect(await exists(join(intDir, "main.py"))).toBe(false);
  });
});
