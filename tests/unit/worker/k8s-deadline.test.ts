import { describe, expect, it } from "vitest";

import {
  COMPILATION_TIMEOUT_MS,
  effectiveTimeLimitMs,
  executionWallTimeLimitMs,
  type SandboxRequest,
} from "@nojv/core";

import {
  computeInteractiveJobDeadlineSeconds,
  computeStageJobDeadlineSeconds,
} from "../../../apps/worker/src/sandbox/kubernetes/job-deadlines";

function mkRequest(
  timeoutMs: number,
  numCases: number,
  judgeType: SandboxRequest["judgeType"] = "standard",
): SandboxRequest {
  return {
    submissionId: "sub-1",
    sourceCode: "",
    language: "python",
    problemType: "full_source",
    judgeType,
    judgeConfig: {},
    testcases: Array.from({ length: numCases }, (_, i) => ({
      index: i,
      input: "",
      expectedOutput: "",
    })),
    limits: { timeoutMs, memoryMb: 256 },
  } as unknown as SandboxRequest;
}

describe("computeStageJobDeadlineSeconds — K8s Job deadline scales with judgeConfig", () => {
  it("reserves compilation and scheduling overhead even for tiny jobs", () => {
    expect(computeStageJobDeadlineSeconds(mkRequest(1000, 1))).toBe(152);
  });

  it("scales with per-case wall budget × case count plus compile and scheduling time", () => {
    expect(computeStageJobDeadlineSeconds(mkRequest(2000, 100))).toBe(550);
  });

  it("caps at 1800s for pathologically large jobs", () => {
    expect(computeStageJobDeadlineSeconds(mkRequest(30000, 256))).toBe(1800);
  });
});

it("adds the checker's validator compile and every slow validator case to the stage", () => {
  expect(computeStageJobDeadlineSeconds(mkRequest(1000, 7, "checker"))).toBe(674);
  expect(computeStageJobDeadlineSeconds(mkRequest(90000, 2000, "checker"))).toBe(1800);
});

it("budgets interactive cases by the slower of the solution wall and the interactor timeout", () => {
  expect(computeInteractiveJobDeadlineSeconds(mkRequest(1000, 3, "interactive"))).toBe(240);
  expect(computeInteractiveJobDeadlineSeconds(mkRequest(20000, 3, "interactive"))).toBe(270);
});

it("allows a Python case its full effective wall budget after compilation", () => {
  const effectiveTimeout = effectiveTimeLimitMs(30_000, "python");
  expect(effectiveTimeout).toBe(90_000);
  const wallMs = executionWallTimeLimitMs(effectiveTimeout);
  expect(wallMs).toBe(180_000);
  const deadline = computeStageJobDeadlineSeconds(mkRequest(effectiveTimeout, 1));
  expect(deadline).toBe(330);
  expect(deadline * 1000).toBeGreaterThan(COMPILATION_TIMEOUT_MS + wallMs);
});
