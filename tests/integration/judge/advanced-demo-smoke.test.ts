import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxRequest } from "@nojv/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdvancedModeExecutor } from "../../../apps/worker/src/services/advanced-mode-executor.js";

const RUN_IMAGE = "nojv-demo-advanced-run:local";
const GRADE_IMAGE = "nojv-demo-advanced-grade:local";

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
      resolve({ ok: !err, stdout: stdout.toString() });
    });
  });
}

async function imagePresent(ref: string): Promise<boolean> {
  const { ok, stdout } = await run("docker", ["images", "-q", ref]);
  return ok && stdout.trim().length > 0;
}

async function requireDemoImages(ctx: { skip: () => void }): Promise<boolean> {
  if (!(await run("docker", ["info"])).ok) {
    ctx.skip();
    return false;
  }
  if ((await imagePresent(RUN_IMAGE)) && (await imagePresent(GRADE_IMAGE))) return true;
  if (process.env.REQUIRE_ADVANCED_DEMO_IMAGES === "1") {
    throw new Error(
      `${RUN_IMAGE} / ${GRADE_IMAGE} missing while REQUIRE_ADVANCED_DEMO_IMAGES=1 — run \`pnpm demo-advanced:build\` first.`,
    );
  }
  ctx.skip();
  return false;
}

function advancedRequest(submissionId: string, sourceCode: string): SandboxRequest {
  return {
    submissionId,
    sourceCode,
    sourceFiles: [{ path: "main.py", content: sourceCode }],
    entryFile: "main.py",
    language: "python",
    problemType: "special_env",
    testcases: [],
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 30_000, memoryMb: 512 },
    advanced: {
      run: { imageRef: RUN_IMAGE, imageSource: "registry" },
      grade: { imageRef: GRADE_IMAGE, imageSource: "registry" },
      network: { mode: "none" },
      totalTimeMs: 30_000,
      memoryMb: 512,
      maxScore: 100,
    },
  };
}

const CORRECT_SOLUTION = `import sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    a, b = map(int, line.split())
    print(a + b)
`;

const MALICIOUS_SOLUTION = `import os
# Try to read the baked answers directly (only the grade image holds them).
try:
    leaked = open("/answers/case-01.out").read()
except Exception as e:
    leaked = f"NO_ANSWERS:{e}"
# Try to smuggle answers to the grade phase as a symlink output that the
# safeCopyTree gate must drop before grade ever sees it.
try:
    os.symlink("/answers/case-01.out", "/workspace/output/case-01.out")
except Exception:
    pass
# Print whatever we managed to read (wrong answers on purpose for cases 1/3).
print(leaked.strip() or "X")
print(leaked.strip() or "X")
print(leaked.strip() or "X")
`;

describe("advanced run/grade demo smoke (real Docker)", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "advanced-demo-smoke-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("scores a correct submission AC end-to-end", async (ctx) => {
    if (!(await requireDemoImages(ctx))) return;

    const executor = new AdvancedModeExecutor();
    const result = await executor.run(tempDir, advancedRequest("smoke-ac", CORRECT_SOLUTION), {
      cpuLimit: "1.0",
      pidsLimit: 64,
    });

    expect(result.pipelineError).toBeUndefined();
    expect(result.compilationError).toBeUndefined();
    const verdicts = result.testcaseResults.map((r) => r.verdict);
    expect(verdicts).toEqual(["AC", "AC", "AC"]);
  }, 120_000);

  it("does not leak baked answers to a malicious submission and never spurious-ACs", async (ctx) => {
    if (!(await requireDemoImages(ctx))) return;

    const executor = new AdvancedModeExecutor();
    const result = await executor.run(
      tempDir,
      advancedRequest("smoke-leak", MALICIOUS_SOLUTION),
      { cpuLimit: "1.0", pidsLimit: 64 },
    );

    expect(result.pipelineError).toBeUndefined();
    const verdicts = result.testcaseResults.map((r) => r.verdict);
    // The run image has no /answers mount (the student's read raises), and the
    // symlink the student plants in output/ is dropped by safeCopyTree, so the
    // grade phase sees no real output and the answers never flow back. The
    // result is therefore an honest WA on every case — never a spurious AC.
    expect(verdicts).toEqual(["WA", "WA", "WA"]);
    expect(result.customScore).toBe(0);
    // The distinctive baked answer for case-02 ("30") must not appear anywhere
    // a leaked symlink could have smuggled it into the result.
    const blob = JSON.stringify(result);
    expect(blob).not.toContain("30");
  }, 120_000);
});
