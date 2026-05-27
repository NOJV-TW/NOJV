import { describe, expect, it } from "vitest";

import { buildAdvancedDockerArgs } from "../../../apps/worker/src/services/advanced-mode-executor";

describe("buildAdvancedDockerArgs", () => {
  const base = {
    containerName: "nojv-advanced-abc",
    networkArgs: ["--network", "none"],
    workspaceDir: "/tmp/job/workspace",
    cpuLimit: "1.0",
    memoryMb: 512,
    pidsLimit: 64,
    imageRef: "ta-image:latest",
    submissionId: "sub-123",
    language: "python",
  };

  it("injects SUBMISSION_ID env var", () => {
    const args = buildAdvancedDockerArgs(base);
    const i = args.indexOf("SUBMISSION_ID=sub-123");
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe("--env");
  });

  it("injects LANGUAGE env var", () => {
    const args = buildAdvancedDockerArgs(base);
    const i = args.indexOf("LANGUAGE=python");
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe("--env");
  });

  it("preserves the existing run/isolation flags and image ref", () => {
    const args = buildAdvancedDockerArgs(base);
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("/tmp/job/workspace:/workspace");
    expect(args[args.length - 1]).toBe("ta-image:latest");
  });
});
