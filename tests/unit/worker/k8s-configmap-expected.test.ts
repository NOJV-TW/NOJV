import type { SandboxRequest } from "@nojv/core";
import { describe, expect, it } from "vitest";

import { buildTestcaseConfigMapData } from "../../../apps/worker/src/services/k8s-executor";

function makeRequest(judgeType: SandboxRequest["judgeType"]): SandboxRequest {
  return {
    submissionId: "sub-1",
    sourceCode: "print(1)",
    language: "python",
    problemType: "standard",
    testcases: [{ index: 0, input: "1 2\n", output: "3\n", weight: 1, isSample: false }],
    judgeType,
    judgeConfig: {},
    limits: { timeoutMs: 1_000, memoryMb: 256 },
  };
}

describe("buildTestcaseConfigMapData expected-output gating", () => {
  it("omits the expected key for standard mode but keeps the input key", () => {
    const data = buildTestcaseConfigMapData(makeRequest("standard"));
    expect(data["testcase-0-input.txt"]).toBe("1 2\n");
    expect(data["testcase-0-expected.txt"]).toBeUndefined();
  });

  it("includes the expected key for checker mode", () => {
    const data = buildTestcaseConfigMapData(makeRequest("checker"));
    expect(data["testcase-0-expected.txt"]).toBe("3\n");
  });
});
