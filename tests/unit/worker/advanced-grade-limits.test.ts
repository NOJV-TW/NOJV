import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxRequest } from "@nojv/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawnDockerContainer: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});
vi.mock("../../../apps/worker/src/sandbox/docker/process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/worker/src/sandbox/docker/process")>()),
  spawnDockerContainer: mocks.spawnDockerContainer,
}));

import {
  AdvancedModeExecutor,
  readAdvancedResult,
} from "../../../apps/worker/src/sandbox/docker/advanced-mode-executor";

const RESULT_MAX_BYTES = 32 * 1024 * 1024;
const validResult = '{"score":100,"verdict":"accepted"}';
const request: SandboxRequest = {
  submissionId: "grade-limits",
  sourceCode: "print('ok')",
  language: "python",
  problemType: "special_env",
  testcases: [],
  judgeType: "standard",
  judgeConfig: {},
  limits: { timeoutMs: 1_000, memoryMb: 256 },
  advanced: {
    run: { imageRef: "run:test", imageSource: "registry" },
    grade: { imageRef: "grade:test", imageSource: "registry" },
    network: { mode: "none" },
    totalTimeMs: 1_000,
    memoryMb: 256,
    maxScore: 100,
  },
};

describe("Advanced Docker grade resource limits", () => {
  let tempDir: string;
  let writeResult: (path: string) => Promise<void>;
  let sizeExceeded: boolean;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(fs.open).mockReset();
    tempDir = await mkdtemp(join(tmpdir(), "nojv-grade-limits-"));
    sizeExceeded = false;
    writeResult = (path) => writeFile(path, validResult);
    mocks.spawnDockerContainer.mockImplementation(async ({ containerName }) => {
      const grade = String(containerName).startsWith("nojv-advanced-grade-");
      if (grade) await writeResult(join(tempDir, "grade", "output", "result.json"));
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        sizeExceeded: grade && sizeExceeded,
        spawnError: null,
      };
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { force: true, recursive: true });
  });

  const execute = () =>
    new AdvancedModeExecutor().run(
      tempDir,
      request,
      { runId: "grade-limits", signal: new AbortController().signal },
      { cpuLimit: "1", pidsLimit: 64 },
    );

  it("watches the grade workspace and preserves a valid result", async () => {
    expect((await execute()).testcaseResults[0]?.verdict).toBe("AC");
    expect(mocks.spawnDockerContainer.mock.calls[1]?.[0].watch?.dir).toBe(
      join(tempDir, "grade"),
    );
  });

  it("rejects a grade workspace overflow even if result.json is valid", async () => {
    sizeExceeded = true;
    const result = await execute();
    expect(result.testcaseResults[0]?.verdict).toBe("SE");
    expect(result.testcaseResults[0]?.stderr).toMatch(/limit/i);
  });

  it("rejects oversized valid JSON before schema parsing", async () => {
    writeResult = (path) => writeFile(path, validResult.padEnd(RESULT_MAX_BYTES + 1));
    expect((await execute()).testcaseResults[0]?.verdict).toBe("SE");
  });

  it("accepts regular result JSON at the exact byte limit", async () => {
    writeResult = (path) => writeFile(path, validResult.padEnd(RESULT_MAX_BYTES));
    expect((await execute()).testcaseResults[0]?.verdict).toBe("AC");
  });

  it("bounds the actual read when a result grows after stat", async () => {
    const path = join(tempDir, "growing.json");
    await writeFile(path, validResult);
    const originalOpen = (
      await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
    ).open;
    const reads: number[] = [];
    vi.mocked(fs.open).mockImplementation(async (filePath, flags, mode) => {
      const file = await originalOpen(filePath, flags, mode);
      const originalStat = file.stat.bind(file);
      const originalRead = file.read.bind(file);
      vi.spyOn(file, "stat").mockImplementation(async () => {
        const info = await originalStat();
        await truncate(path, RESULT_MAX_BYTES + 1);
        return info;
      });
      vi.spyOn(file, "read").mockImplementation(async (buffer, offset, length, position) => {
        reads.push(length);
        return originalRead(buffer, offset, length, position);
      });
      return file;
    });
    await expect(readAdvancedResult(path)).rejects.toThrow(/grew/);
    expect(reads.reduce((total, size) => total + size, 0)).toBe(validResult.length + 1);
    expect(fs.open).toHaveBeenCalledWith(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  });

  it("rejects a result symlink", async () => {
    writeResult = async (path) => {
      const target = join(tempDir, "outside.json");
      await writeFile(target, validResult);
      await symlink(target, path);
    };
    expect((await execute()).testcaseResults[0]?.verdict).toBe("SE");
  });

  it("rejects non-regular result files without blocking", async () => {
    writeResult = async (path) => {
      execFileSync("mkfifo", [path]);
    };
    expect((await execute()).testcaseResults[0]?.verdict).toBe("SE");
  });
});
