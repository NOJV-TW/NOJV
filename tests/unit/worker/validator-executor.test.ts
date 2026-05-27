import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildValidatorDockerArgs,
  writeValidatorFiles,
  type ValidatorRunParams,
} from "../../../apps/worker/src/services/validator-executor";

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("buildValidatorDockerArgs", () => {
  const base = {
    containerName: "nojv-validate-abc",
    tempDir: "/tmp/job",
    cpuLimit: "1.0",
    memoryMb: 256,
    pidsLimit: 64,
    image: "nojv-sandbox:local",
  };

  it("applies the standard run-container hardening flags", () => {
    const args = buildValidatorDockerArgs(base);
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--read-only");
    expect(args).toContain("--user");
    expect(args).toContain("10001:10001");
    expect(args).toContain("--pids-limit");
  });

  it("mounts the temp dir read-only at /submission and runs the runner", () => {
    const args = buildValidatorDockerArgs(base);
    expect(args).toContain("/tmp/job:/submission:ro");
    expect(args.slice(-3)).toEqual(["nojv-sandbox:local", "node", "/runner/index.js"]);
  });
});

describe("writeValidatorFiles", () => {
  let tempDir: string;

  const params: ValidatorRunParams = {
    submissionId: "sub-1",
    validatorScript: "accept()\n",
    validatorLanguage: "python",
    cases: [
      { index: 0, input: "1\n", answer: "ans0\n", teamOutput: "team0\n" },
      { index: 1, input: "2\n", answer: "ans1\n", teamOutput: "team1\n" },
    ],
    limits: { timeoutMs: 1_000, memoryMb: 256 },
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "nojv-validate-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes the validator source with the language extension", async () => {
    await writeValidatorFiles(tempDir, params);
    expect(await exists(join(tempDir, "validator.py"))).toBe(true);
    expect(await readFile(join(tempDir, "validator.py"), "utf8")).toBe("accept()\n");
  });

  it("writes a config.json carrying the validate block + case indices", async () => {
    await writeValidatorFiles(tempDir, params);
    const config = JSON.parse(await readFile(join(tempDir, "config.json"), "utf8"));
    expect(config.validate).toEqual({
      language: "python",
      cases: [{ index: 0 }, { index: 1 }],
    });
  });

  it("writes per-case input/answer/team files under cases/{index}/", async () => {
    await writeValidatorFiles(tempDir, params);
    expect(await readFile(join(tempDir, "cases", "0", "input.txt"), "utf8")).toBe("1\n");
    expect(await readFile(join(tempDir, "cases", "0", "answer.txt"), "utf8")).toBe("ans0\n");
    expect(await readFile(join(tempDir, "cases", "0", "team.txt"), "utf8")).toBe("team0\n");
    expect(await readFile(join(tempDir, "cases", "1", "team.txt"), "utf8")).toBe("team1\n");
  });

  it("uses the cpp extension for cpp validators", async () => {
    await writeValidatorFiles(tempDir, { ...params, validatorLanguage: "cpp" });
    expect(await exists(join(tempDir, "validator.cpp"))).toBe(true);
  });
});
