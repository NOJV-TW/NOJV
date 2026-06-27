import { describe, expect, it } from "vitest";

import { buildSandboxDockerArgs } from "../../../apps/worker/src/services/docker-args";

function swapMatchesMemory(args: string[], expected: string): void {
  const memVal = args[args.indexOf("--memory") + 1];
  const swapIdx = args.indexOf("--memory-swap");
  expect(memVal).toBe(expected);
  expect(swapIdx).toBeGreaterThan(-1);
  expect(args[swapIdx + 1]).toBe(expected);
}

describe("buildSandboxDockerArgs hardening profile", () => {
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
    const args = buildSandboxDockerArgs(base);
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--user");
    expect(args).toContain("10001:10001");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("--security-opt");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--read-only");
    expect(args).toContain("--pids-limit");
    expect(args).toContain("/tmp/job:/submission:ro");
  });

  it("caps swap at the memory limit so MLE is independent of host swap config", () => {
    swapMatchesMemory(buildSandboxDockerArgs(base), "256m");
  });

  it("attaches stdin in interactive mode with -i immediately after run", () => {
    const args = buildSandboxDockerArgs({ ...base, interactive: true });
    expect(args[0]).toBe("run");
    expect(args[1]).toBe("-i");
  });
});
