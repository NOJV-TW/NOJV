import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { CustomScriptStage } from "@nojv/core";
import { runCustomScriptStage } from "../src/stages/custom-script.js";

function hasPython3(): boolean {
  const result = spawnSync("python3", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

describe("custom-script stage", () => {
  it("executes script and parses JSON output", async () => {
    if (!hasPython3()) {
      return;
    }

    const stage: CustomScriptStage = {
      type: "custom-script",
      name: "post-check-metadata",
      continueOnFail: true,
      config: {
        language: "python",
        timeoutMs: 10_000,
        runAt: "after-check",
        script: [
          "import json, sys",
          "payload = json.loads(sys.stdin.read())",
          "print(json.dumps({",
          "  'passed': True,",
          "  'feedback': f\"hook={payload.get('runAt')}\",",
          "  'metadata': {'judgeType': payload.get('judgeType')}",
          "}))"
        ].join("\n")
      }
    };

    const result = await runCustomScriptStage(stage, "after-check", {
      submissionId: "s1",
      language: "python",
      judgeType: "standard",
      workDir: "/tmp",
      sourcePath: "/tmp/main.py",
      rawScore: 100,
      testcaseResults: []
    });

    expect(result.passed).toBe(true);
    expect(result.feedback).toBe("hook=after-check");
    expect(result.metadata).toEqual({ judgeType: "standard" });
  });
});
