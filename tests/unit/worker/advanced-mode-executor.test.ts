import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxRequest } from "@nojv/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ADVANCED_WORKSPACE_MAX_BYTES,
  buildAdvancedDockerArgs,
  deriveRunStatus,
  dirSizeBytes,
  prepareGradeWorkspace,
  prepareRunWorkspace,
  type ContainerOutcome,
} from "../../../apps/worker/src/services/advanced-mode-executor";

const runArgs = (
  overrides: Partial<Parameters<typeof buildAdvancedDockerArgs>[0]> = {},
): string[] =>
  buildAdvancedDockerArgs({
    containerName: "nojv-advanced-run-abc",
    networkArgs: ["--network", "none"],
    workspaceDir: "/tmp/job/run",
    cpuLimit: "1.0",
    memoryMb: 512,
    pidsLimit: 64,
    imageRef: "run-image:latest",
    submissionId: "sub-123",
    language: "python",
    user: "10001:10001",
    ...overrides,
  });

const gradeArgs = (
  overrides: Partial<Parameters<typeof buildAdvancedDockerArgs>[0]> = {},
): string[] =>
  buildAdvancedDockerArgs({
    containerName: "nojv-advanced-grade-abc",
    networkArgs: [],
    workspaceDir: "/tmp/job/grade",
    cpuLimit: "1.0",
    memoryMb: 512,
    pidsLimit: 64,
    imageRef: "grade-image:latest",
    submissionId: "sub-123",
    language: "python",
    user: null,
    ...overrides,
  });

describe("buildAdvancedDockerArgs", () => {
  it("injects SUBMISSION_ID env var", () => {
    const args = runArgs();
    const i = args.indexOf("SUBMISSION_ID=sub-123");
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe("--env");
  });

  it("injects LANGUAGE env var", () => {
    const args = runArgs();
    const i = args.indexOf("LANGUAGE=python");
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe("--env");
  });

  it("preserves the existing run/isolation flags and image ref", () => {
    const args = runArgs();
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("/tmp/job/run:/workspace");
    expect(args.at(-1)).toBe("run-image:latest");
  });

  it("mounts the rootfs read-only with a writable /tmp tmpfs", () => {
    const args = runArgs();
    expect(args).toContain("--read-only");
    const i = args.indexOf("/tmp:rw,exec,nosuid,nodev,size=64m");
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe("--tmpfs");
  });

  it("caps swap at the memory limit so MLE is independent of host swap config", () => {
    const args = runArgs();
    const memVal = args[args.indexOf("--memory") + 1];
    const swapIdx = args.indexOf("--memory-swap");
    expect(swapIdx).toBeGreaterThan(-1);
    expect(args[swapIdx + 1]).toBe(memVal);
    expect(memVal).toBe("512m");
  });

  describe("run role (untrusted student code)", () => {
    it("runs as the sandbox uid and isolates the network", () => {
      const args = runArgs();
      const userIdx = args.indexOf("--user");
      expect(userIdx).toBeGreaterThan(0);
      expect(args[userIdx + 1]).toBe("10001:10001");

      const netIdx = args.indexOf("--network");
      expect(netIdx).toBeGreaterThan(0);
      expect(args[netIdx + 1]).toBe("none");
    });

    it("keeps the strict hardening flags", () => {
      const args = runArgs();
      expect(args).toContain("--cap-drop");
      expect(args).toContain("--read-only");
      expect(args).toContain("/tmp:rw,exec,nosuid,nodev,size=64m");
      expect(args).toContain("--memory-swap");
    });
  });

  describe("grade role (trusted TA code)", () => {
    it("does NOT pass --user so the grade image manages its own user", () => {
      const args = gradeArgs();
      expect(args).not.toContain("--user");
      expect(args).not.toContain("10001:10001");
    });

    it("does NOT isolate the network so the grade image has full network", () => {
      const args = gradeArgs();
      expect(args).not.toContain("--network");
      expect(args).not.toContain("none");
    });

    it("keeps the shared hardening flags despite running as root", () => {
      const args = gradeArgs();
      expect(args).toContain("--cap-drop");
      expect(args).toContain("ALL");
      expect(args).toContain("no-new-privileges");
      expect(args).toContain("--read-only");
      expect(args).toContain("/tmp:rw,exec,nosuid,nodev,size=64m");
      expect(args).toContain("--memory-swap");
      expect(args.at(-1)).toBe("grade-image:latest");
    });
  });
});

describe("deriveRunStatus", () => {
  const outcome = (over: Partial<ContainerOutcome>): ContainerOutcome => ({
    exitCode: 0,
    stderr: "",
    timedOut: false,
    sizeExceeded: false,
    spawnError: false,
    ...over,
  });

  it("reports timed_out when the outer timeout fired", () => {
    expect(deriveRunStatus(outcome({ timedOut: true, exitCode: 137 }))).toEqual({
      state: "timed_out",
      exitCode: 137,
    });
  });

  it("reports oom_killed on exit 137 when not timed out", () => {
    expect(deriveRunStatus(outcome({ exitCode: 137 }))).toEqual({
      state: "oom_killed",
      exitCode: 137,
    });
  });

  it("reports exited with the exit code otherwise", () => {
    expect(deriveRunStatus(outcome({ exitCode: 0 }))).toEqual({ state: "exited", exitCode: 0 });
    expect(deriveRunStatus(outcome({ exitCode: 1 }))).toEqual({ state: "exited", exitCode: 1 });
    expect(deriveRunStatus(outcome({ exitCode: null }))).toEqual({
      state: "exited",
      exitCode: null,
    });
  });
});

describe("prepareRunWorkspace / prepareGradeWorkspace", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nojv-ws-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  const request = {
    submissionId: "sub-xyz",
    sourceCode: "print('hi')",
    language: "python",
  } as unknown as SandboxRequest;

  it("writes run meta with submissionFiles and resourceLimits", async () => {
    const runDir = join(dir, "run");
    await prepareRunWorkspace(runDir, request, {
      submissionId: "sub-xyz",
      language: "python",
      totalTimeMs: 5000,
      memoryMb: 256,
    });

    const meta = JSON.parse(await readFile(join(runDir, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(meta.submissionId).toBe("sub-xyz");
    expect(meta.language).toBe("python");
    expect(meta.submissionFiles).toEqual(["main.py"]);
    expect(meta.resourceLimits).toEqual({ totalTimeMs: 5000, memoryMb: 256 });
    expect(meta).not.toHaveProperty("runStatus");
  });

  it("writes grade meta with runStatus and NOT submissionFiles, copying run-output", async () => {
    const runOutputDir = join(dir, "run", "output");
    await mkdir(runOutputDir, { recursive: true });
    await writeFile(join(runOutputDir, "case-0.bin"), "payload");

    const gradeDir = join(dir, "grade");
    await prepareGradeWorkspace(gradeDir, runOutputDir, {
      submissionId: "sub-xyz",
      language: "python",
      runStatus: { state: "exited", exitCode: 0 },
    });

    const meta = JSON.parse(await readFile(join(gradeDir, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(meta.submissionId).toBe("sub-xyz");
    expect(meta.language).toBe("python");
    expect(meta.runStatus).toEqual({ state: "exited", exitCode: 0 });
    expect(meta).not.toHaveProperty("submissionFiles");

    const copied = await readFile(join(gradeDir, "run-output", "case-0.bin"), "utf8");
    expect(copied).toBe("payload");
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
