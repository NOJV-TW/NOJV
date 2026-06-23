import { describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";
import { resolveContainerMemoryMb } from "@nojv/core";

import { resolveDockerMemoryMb } from "../../../apps/worker/src/services/docker-executor";
import { resolveK8sMemoryLimit } from "../../../apps/worker/src/services/k8s-executor";

const OPTS = { defaultMemoryMb: 256, headroomMb: 64, maxMemoryMb: 2048 };

function requestWithMemory(memoryMb: number | undefined): SandboxRequest {
  return {
    submissionId: "sub-1",
    sourceCode: "",
    language: "cpp",
    problemType: "standard",
    testcases: [],
    judgeType: "standard",
    judgeConfig: {},
    limits: {
      timeoutMs: 1_000,
      ...(memoryMb !== undefined ? { memoryMb } : {}),
    } as SandboxRequest["limits"],
  };
}

describe("resolveContainerMemoryMb", () => {
  it("derives the container hard limit from the per-problem limit plus headroom", () => {
    expect(resolveContainerMemoryMb(512, OPTS)).toBe(512 + 64);
    expect(resolveContainerMemoryMb(1024, OPTS)).toBe(1024 + 64);
  });

  it("falls back to the cluster default (plus headroom) when no per-problem limit is set", () => {
    expect(resolveContainerMemoryMb(undefined, OPTS)).toBe(256 + 64);
  });

  it("clamps to the node-capacity ceiling so headroom cannot exceed the max", () => {
    expect(resolveContainerMemoryMb(1024, { ...OPTS, maxMemoryMb: 1024 })).toBe(1024);
    expect(resolveContainerMemoryMb(2000, { ...OPTS, maxMemoryMb: 2048 })).toBe(2048);
  });

  it("never returns below the per-problem allowance, even if the ceiling is misconfigured low", () => {
    expect(resolveContainerMemoryMb(512, { ...OPTS, maxMemoryMb: 256 })).toBe(512);
  });
});

describe("docker executor derives the cgroup limit from the per-problem allowance", () => {
  const config = {
    cpuLimit: "1.0",
    image: "nojv-sandbox:local",
    memoryMb: 256,
    pidsLimit: 64,
    headroomMb: 64,
    maxMemoryMb: 2048,
  };

  it("a 512MB problem (cluster default 256) gets a cgroup limit of at least 512MB", () => {
    const resolved = resolveDockerMemoryMb(requestWithMemory(512), config);
    expect(resolved).toBeGreaterThanOrEqual(512);
    expect(resolved).not.toBe(256);
  });

  it("a problem with no per-problem limit falls back to the cluster default plus headroom", () => {
    const resolved = resolveDockerMemoryMb(requestWithMemory(undefined), config);
    expect(resolved).toBe(256 + 64);
  });
});

describe("k8s executor derives the pod memory limit from the per-problem allowance", () => {
  const config = {
    namespace: "nojv-sandbox",
    image: "img:latest",
    cpuRequest: "500m",
    cpuLimit: "1",
    memoryRequest: "256Mi",
    memoryLimit: "256Mi",
    headroomMb: 64,
    maxMemoryMb: 2048,
  };

  function asMi(limit: string): number {
    return Number(limit.replace(/Mi$/, ""));
  }

  it("a 512MB problem (cluster default 256Mi) gets a pod memory limit of at least 512Mi", () => {
    const resolved = resolveK8sMemoryLimit(requestWithMemory(512), config);
    expect(asMi(resolved)).toBeGreaterThanOrEqual(512);
    expect(asMi(resolved)).not.toBe(256);
  });

  it("a problem with no per-problem limit falls back to the cluster default plus headroom", () => {
    const resolved = resolveK8sMemoryLimit(requestWithMemory(undefined), config);
    expect(asMi(resolved)).toBe(256 + 64);
  });
});
