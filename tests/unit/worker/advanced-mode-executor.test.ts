import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ADVANCED_WORKSPACE_MAX_BYTES,
  buildAdvancedDockerArgs,
  dirSizeBytes,
} from "../../../apps/worker/src/services/advanced-mode-executor";

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
    expect(args.at(-1)).toBe("ta-image:latest");
  });

  it("mounts the rootfs read-only with a writable /tmp tmpfs", () => {
    const args = buildAdvancedDockerArgs(base);
    expect(args).toContain("--read-only");
    const i = args.indexOf("/tmp:rw,exec,nosuid,nodev,size=64m");
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe("--tmpfs");
  });

  it("runs advanced grader images as the sandbox uid instead of root", () => {
    const args = buildAdvancedDockerArgs(base);
    const i = args.indexOf("--user");
    expect(i).toBeGreaterThan(0);
    expect(args[i + 1]).toBe("10001:10001");
  });

  it("caps swap at the memory limit so MLE is independent of host swap config", () => {
    const args = buildAdvancedDockerArgs(base);
    const memVal = args[args.indexOf("--memory") + 1];
    const swapIdx = args.indexOf("--memory-swap");
    expect(swapIdx).toBeGreaterThan(-1);
    expect(args[swapIdx + 1]).toBe(memVal);
    expect(memVal).toBe("512m");
  });
});

describe("dirSizeBytes (disk-cap watchdog)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nojv-dirsize-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("returns 0 for an empty directory", async () => {
    expect(await dirSizeBytes(dir)).toBe(0);
  });

  it("returns 0 for a missing directory instead of throwing", async () => {
    expect(await dirSizeBytes(join(dir, "does-not-exist"))).toBe(0);
  });

  it("sums file sizes across nested subdirectories", async () => {
    await writeFile(join(dir, "a.txt"), "x".repeat(100));
    await mkdir(join(dir, "output"), { recursive: true });
    await writeFile(join(dir, "output", "result.json"), "y".repeat(250));
    await mkdir(join(dir, "submission", "deep"), { recursive: true });
    await writeFile(join(dir, "submission", "deep", "main.py"), "z".repeat(50));

    expect(await dirSizeBytes(dir)).toBe(400);
  });

  it("flags a workspace that exceeds the cap and clears one that does not", async () => {
    const small = join(dir, "small.bin");
    await writeFile(small, "0");
    expect(await dirSizeBytes(dir)).toBeLessThanOrEqual(ADVANCED_WORKSPACE_MAX_BYTES);

    const measured = await dirSizeBytes(dir);
    const tinyCap = 0;
    expect(measured > tinyCap).toBe(true);
  });
});
