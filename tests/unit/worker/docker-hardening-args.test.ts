import { describe, expect, it } from "vitest";

import { buildStandardDockerArgs } from "../../../apps/worker/src/services/standard-mode-executor";
import { buildContainerArgs as buildInteractiveDockerArgs } from "../../../apps/worker/src/services/interactive-executor";
import { buildValidatorDockerArgs } from "../../../apps/worker/src/services/validator-executor";

function swapMatchesMemory(args: string[], expected: string): void {
  const memVal = args[args.indexOf("--memory") + 1];
  const swapIdx = args.indexOf("--memory-swap");
  expect(memVal).toBe(expected);
  expect(swapIdx).toBeGreaterThan(-1);
  expect(args[swapIdx + 1]).toBe(expected);
}

function expectIsolationFlags(args: string[]): void {
  expect(args).toContain("--user");
  expect(args).toContain("10001:10001");
  expect(args).toContain("--cap-drop");
  expect(args).toContain("ALL");
  expect(args).toContain("--security-opt");
  expect(args).toContain("no-new-privileges");
  expect(args).toContain("--read-only");
  expect(args).toContain("--pids-limit");
  expect(args).toContain("--network");
  expect(args).toContain("none");
}

describe("untrusted-code builders share one hardening profile (drift guard)", () => {
  const base = {
    containerName: "nojv-x",
    tempDir: "/tmp/job",
    cpuLimit: "1.0",
    memoryMb: 256,
    pidsLimit: 64,
    image: "nojv-sandbox:local",
  };
  const builders: [string, (p: typeof base) => string[]][] = [
    ["standard", (p) => buildStandardDockerArgs({ ...p, networkArgs: ["--network", "none"] })],
    ["interactive", buildInteractiveDockerArgs],
    ["validator", buildValidatorDockerArgs],
  ];
  for (const [name, build] of builders) {
    it(`${name} pins uid + drops caps + no-new-privileges + read-only + pids-limit + no network`, () => {
      const args = build(base);
      expectIsolationFlags(args);
      swapMatchesMemory(args, "256m");
    });
  }
});

describe("buildStandardDockerArgs hardening profile", () => {
  const base = {
    containerName: "nojv-judge-abc",
    networkArgs: ["--network", "none"],
    tempDir: "/tmp/job",
    cpuLimit: "1.0",
    memoryMb: 256,
    pidsLimit: 64,
    image: "nojv-sandbox:local",
  };

  it("applies the full isolation flag set", () => {
    const args = buildStandardDockerArgs(base);
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--user");
    expect(args).toContain("10001:10001");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--read-only");
    expect(args).toContain("--pids-limit");
    expect(args).toContain("/tmp/job:/submission:ro");
  });

  it("caps swap at the memory limit so MLE is independent of host swap config", () => {
    swapMatchesMemory(buildStandardDockerArgs(base), "256m");
  });
});

describe("buildContainerArgs (interactive) hardening profile", () => {
  const base = {
    containerName: "nojv-interactive-abc",
    tempDir: "/tmp/job",
    cpuLimit: "1.0",
    memoryMb: 512,
    pidsLimit: 64,
    image: "nojv-sandbox:local",
  };

  it("applies the full isolation flag set with stdin attached", () => {
    const args = buildInteractiveDockerArgs(base);
    expect(args[0]).toBe("run");
    expect(args).toContain("-i");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--read-only");
  });

  it("caps swap at the memory limit so MLE is independent of host swap config", () => {
    swapMatchesMemory(buildInteractiveDockerArgs(base), "512m");
  });
});
