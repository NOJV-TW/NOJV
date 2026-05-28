import type { SandboxRequest } from "@nojv/core";
import { describe, expect, it } from "vitest";

import { buildSandboxConfigJson } from "../../../apps/worker/src/services/sandbox-plan";

function makeRequest(env?: Record<string, string>): SandboxRequest {
  return {
    submissionId: "sub-1",
    sourceCode: "print(1)",
    language: "python",
    problemType: "full_source",
    testcases: [],
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 1_000, memoryMb: 256, ...(env ? { env } : {}) },
  };
}

describe("buildSandboxConfigJson env", () => {
  it("carries limits.env into the config json", () => {
    const config = buildSandboxConfigJson(makeRequest({ JUDGE_MODE: "fast" }), []);
    expect((config.limits as { env?: Record<string, string> }).env).toEqual({
      JUDGE_MODE: "fast",
    });
  });

  it("omits env when none is set", () => {
    const config = buildSandboxConfigJson(makeRequest(), []);
    expect((config.limits as { env?: Record<string, string> }).env).toBeUndefined();
  });
});
