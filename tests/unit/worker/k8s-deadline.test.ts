import { describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { computeJobDeadlineSeconds } from "../../../apps/worker/src/services/k8s-executor";

function mkRequest(timeoutMs: number, numCases: number): SandboxRequest {
  return {
    submissionId: "sub-1",
    sourceCode: "",
    language: "python",
    problemType: "full_source",
    judgeType: "standard",
    judgeConfig: {},
    testcases: Array.from({ length: numCases }, (_, i) => ({
      index: i,
      input: "",
      expectedOutput: "",
    })),
    limits: { timeoutMs, memoryMb: 256 },
  } as unknown as SandboxRequest;
}

describe("computeJobDeadlineSeconds — K8s Job deadline scales with judgeConfig", () => {
  it("floors at 120s for tiny jobs", () => {
    expect(computeJobDeadlineSeconds(mkRequest(1000, 1))).toBe(120);
  });

  it("scales with per-case timeout × case count (+buffer)", () => {
    expect(computeJobDeadlineSeconds(mkRequest(2000, 100))).toBe(260);
  });

  it("caps at 1800s for pathologically large jobs", () => {
    expect(computeJobDeadlineSeconds(mkRequest(30000, 256))).toBe(1800);
  });
});
