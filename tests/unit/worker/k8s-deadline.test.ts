import { describe, expect, it } from "vitest";

import {
  COMPILATION_TIMEOUT_MS,
  effectiveTimeLimitMs,
  executionWallTimeLimitMs,
  type SandboxRequest,
} from "@nojv/core";

import {
  computeJobDeadlineSeconds,
  computeValidatorJobDeadlineSeconds,
} from "../../../apps/worker/src/services/k8s-configmaps";

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
  it("reserves compilation and scheduling overhead even for tiny jobs", () => {
    expect(computeJobDeadlineSeconds(mkRequest(1000, 1))).toBe(152);
  });

  it("scales with per-case wall budget × case count plus compile and scheduling time", () => {
    expect(computeJobDeadlineSeconds(mkRequest(2000, 100))).toBe(550);
  });

  it("caps at 1800s for pathologically large jobs", () => {
    expect(computeJobDeadlineSeconds(mkRequest(30000, 256))).toBe(1800);
  });
});

it("budgets all slow validator cases using the 30s validator floor and 2x wall grace", () => {
  expect(computeValidatorJobDeadlineSeconds(1000, 7)).toBe(570);
  expect(computeValidatorJobDeadlineSeconds(45000, 3)).toBe(420);
  expect(computeValidatorJobDeadlineSeconds(90000, 2000)).toBe(1800);
});

it("allows a Python case its full effective wall budget after compilation", () => {
  const effectiveTimeout = effectiveTimeLimitMs(30_000, "python");
  expect(effectiveTimeout).toBe(90_000);
  const wallMs = executionWallTimeLimitMs(effectiveTimeout);
  expect(wallMs).toBe(180_000);
  const deadline = computeJobDeadlineSeconds(mkRequest(effectiveTimeout, 1));
  expect(deadline).toBe(330);
  expect(deadline * 1000).toBeGreaterThan(COMPILATION_TIMEOUT_MS + wallMs);
});
