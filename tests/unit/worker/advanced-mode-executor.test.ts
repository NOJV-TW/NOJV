import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxRequest } from "@nojv/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ADVANCED_WORKSPACE_MAX_BYTES,
  buildAdvancedDockerArgs,
  buildProxyEnv,
  deriveRunStatus,
  dirStats,
  exceedsWorkspaceCaps,
  prepareGradeWorkspace,
  prepareRunWorkspace,
  safeCopyTree,
  SafeCopyLimitError,
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

    it("mounts the captured run-output read-only on top of the writable workspace", () => {
      const args = gradeArgs({
        workspaceDir: "/tmp/job/grade",
        readOnlyMounts: [
          { hostPath: "/tmp/job/grade/run-output", containerPath: "/workspace/run-output" },
        ],
      });
      expect(args).toContain("/tmp/job/grade:/workspace");
      const roIdx = args.indexOf("/tmp/job/grade/run-output:/workspace/run-output:ro");
      expect(roIdx).toBeGreaterThan(0);
      expect(args[roIdx - 1]).toBe("-v");

      const workspaceIdx = args.indexOf("/tmp/job/grade:/workspace");
      expect(roIdx).toBeGreaterThan(workspaceIdx);
    });
  });
});

describe("allowlist network mode (Phase 3 run-container egress)", () => {
  it("buildProxyEnv sets all four proxy env vars to the proxy URL with empty NO_PROXY", () => {
    const env = buildProxyEnv("http://10.88.5.2:8888");
    expect(env).toEqual({
      HTTP_PROXY: "http://10.88.5.2:8888",
      HTTPS_PROXY: "http://10.88.5.2:8888",
      http_proxy: "http://10.88.5.2:8888",
      https_proxy: "http://10.88.5.2:8888",
      NO_PROXY: "",
      no_proxy: "",
    });
  });

  it("run args attach ONLY the internal network and inject HTTP_PROXY in allowlist mode", () => {
    const args = runArgs({
      networkArgs: ["--network", "nojv-net-internal-sub-123"],
      extraEnv: buildProxyEnv("http://10.88.5.2:8888"),
    });

    const netIdx = args.indexOf("--network");
    expect(args[netIdx + 1]).toBe("nojv-net-internal-sub-123");
    expect(args).not.toContain("nojv-net-egress-sub-123");
    expect(args.filter((a) => a === "--network")).toHaveLength(1);

    const proxyIdx = args.indexOf("HTTP_PROXY=http://10.88.5.2:8888");
    expect(proxyIdx).toBeGreaterThan(0);
    expect(args[proxyIdx - 1]).toBe("--env");
    expect(args).toContain("HTTPS_PROXY=http://10.88.5.2:8888");
    expect(args).toContain("http_proxy=http://10.88.5.2:8888");
    expect(args).toContain("https_proxy=http://10.88.5.2:8888");
  });

  it("run args in none mode use --network none and carry NO proxy env", () => {
    const args = runArgs({ networkArgs: ["--network", "none"] });
    const netIdx = args.indexOf("--network");
    expect(args[netIdx + 1]).toBe("none");
    expect(args.some((a) => a.startsWith("HTTP_PROXY="))).toBe(false);
    expect(args.some((a) => a.startsWith("http_proxy="))).toBe(false);
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

describe("dirStats + exceedsWorkspaceCaps (Task 2.2 watchdog)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nojv-dirstats-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("returns zero bytes and files for an empty directory", async () => {
    expect(await dirStats(dir)).toEqual({ bytes: 0, files: 0 });
  });

  it("returns zero bytes and files for a missing directory instead of throwing", async () => {
    expect(await dirStats(join(dir, "does-not-exist"))).toEqual({ bytes: 0, files: 0 });
  });

  it("counts both bytes and files across nested subdirectories", async () => {
    await writeFile(join(dir, "a.txt"), "x".repeat(100));
    await mkdir(join(dir, "output"), { recursive: true });
    await writeFile(join(dir, "output", "result.json"), "y".repeat(250));
    await mkdir(join(dir, "submission", "deep"), { recursive: true });
    await writeFile(join(dir, "submission", "deep", "main.py"), "z".repeat(50));

    expect(await dirStats(dir)).toEqual({ bytes: 400, files: 3 });
  });

  it("genuinely triggers the watchdog when the file-count cap is exceeded", async () => {
    for (let i = 0; i < 5; i++) {
      await writeFile(join(dir, `f${String(i)}.txt`), "1");
    }
    const stats = await dirStats(dir);
    expect(stats.files).toBe(5);

    expect(
      exceedsWorkspaceCaps(stats, {
        maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
        maxFiles: 4,
      }),
    ).toBe(true);
    expect(
      exceedsWorkspaceCaps(stats, {
        maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
        maxFiles: 5,
      }),
    ).toBe(false);
  });

  it("genuinely triggers the watchdog when the byte cap is exceeded", async () => {
    await writeFile(join(dir, "big.bin"), "Z".repeat(1024));
    const stats = await dirStats(dir);

    expect(exceedsWorkspaceCaps(stats, { maxBytes: 1023, maxFiles: 100_000 })).toBe(true);
    expect(exceedsWorkspaceCaps(stats, { maxBytes: 1024, maxFiles: 100_000 })).toBe(false);
  });
});

describe("safeCopyTree (/output capture security gate)", () => {
  let src: string;
  let dest: string;

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), "nojv-safecopy-"));
    src = join(base, "src");
    dest = join(base, "dest");
    await mkdir(src, { recursive: true });
  });

  afterEach(async () => {
    await rm(join(src, ".."), { force: true, recursive: true });
  });

  const listFiles = async (root: string): Promise<string[]> => {
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      const entries = await readdir(join(root, rel), { withFileTypes: true });
      for (const e of entries) {
        const child = rel ? join(rel, e.name) : e.name;
        if (e.isDirectory()) await walk(child);
        else out.push(child);
      }
    };
    await walk("");
    return out.sort();
  };

  it("drops absolute and relative symlinks, copies the real file (answer-leak gate)", async () => {
    await symlink("/answers/secret", join(src, "leak"));
    await symlink("../escape", join(src, "rel"));
    await writeFile(join(src, "ans.txt"), "the real output");

    await safeCopyTree(src, dest, {
      maxFiles: 100_000,
      maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
    });

    expect(await listFiles(dest)).toEqual(["ans.txt"]);
    expect(await readFile(join(dest, "ans.txt"), "utf8")).toBe("the real output");
  });

  it("skips a FIFO special file without hanging and never copies it", async () => {
    const fifo = join(src, "pipe");
    execFileSync("mkfifo", [fifo]);
    await writeFile(join(src, "normal.txt"), "ok");

    await safeCopyTree(src, dest, {
      maxFiles: 100_000,
      maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
    });

    expect(await listFiles(dest)).toEqual(["normal.txt"]);
  });

  it("throws SafeCopyLimitError when the file count exceeds maxFiles", async () => {
    for (let i = 0; i < 6; i++) {
      await writeFile(join(src, `f${String(i)}.txt`), "x");
    }
    await expect(
      safeCopyTree(src, dest, { maxFiles: 5, maxBytes: ADVANCED_WORKSPACE_MAX_BYTES }),
    ).rejects.toBeInstanceOf(SafeCopyLimitError);
  });

  it("throws SafeCopyLimitError when the byte total exceeds maxBytes", async () => {
    await writeFile(join(src, "a.bin"), "A".repeat(600));
    await writeFile(join(src, "b.bin"), "B".repeat(600));
    await expect(
      safeCopyTree(src, dest, { maxFiles: 100_000, maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(SafeCopyLimitError);
  });

  it("copies a tree at EXACTLY maxFiles without throwing (off-by-one lock)", async () => {
    for (let i = 0; i < 5; i++) {
      await writeFile(join(src, `f${String(i)}.txt`), "x");
    }
    await safeCopyTree(src, dest, { maxFiles: 5, maxBytes: ADVANCED_WORKSPACE_MAX_BYTES });
    expect(await listFiles(dest)).toEqual(["f0.txt", "f1.txt", "f2.txt", "f3.txt", "f4.txt"]);
  });

  it("copies a tree at EXACTLY maxBytes without throwing (off-by-one lock)", async () => {
    await writeFile(join(src, "a.bin"), "A".repeat(400));
    await writeFile(join(src, "b.bin"), "B".repeat(600));
    await safeCopyTree(src, dest, { maxFiles: 100_000, maxBytes: 1000 });
    expect(await listFiles(dest)).toEqual(["a.bin", "b.bin"]);
  });

  it("round-trips non-UTF8 binary bytes losslessly", async () => {
    const payload = Buffer.from([0, 255, 128, 0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(src, "image.png"), payload);

    await safeCopyTree(src, dest, {
      maxFiles: 100_000,
      maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
    });

    const copied = await readFile(join(dest, "image.png"));
    expect(copied.equals(payload)).toBe(true);
  });

  it("copies nested directory trees structurally", async () => {
    await mkdir(join(src, "a", "b", "c"), { recursive: true });
    await writeFile(join(src, "a", "top.txt"), "1");
    await writeFile(join(src, "a", "b", "mid.txt"), "2");
    await writeFile(join(src, "a", "b", "c", "leaf.txt"), "3");

    await safeCopyTree(src, dest, {
      maxFiles: 100_000,
      maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
    });

    expect(await listFiles(dest)).toEqual([
      join("a", "b", "c", "leaf.txt"),
      join("a", "b", "mid.txt"),
      join("a", "top.txt"),
    ]);
    expect(await readFile(join(dest, "a", "b", "c", "leaf.txt"), "utf8")).toBe("3");
  });
});
