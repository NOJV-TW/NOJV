import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compileValidator } from "../../../apps/sandbox-runner/src/compiler.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "validator-compile-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

describe("compileValidator (python)", () => {
  it("prepends the DOMjudge wrapper and runs via python3", async () => {
    const src = join(workDir, "validator.src.py");
    await writeFile(src, "accept('looks good')\n");

    const result = await compileValidator(src, "python", workDir);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.runCommand[0]).toBe("python3");
    const wrapped = await readFile(result.runCommand[1]!, "utf8");
    expect(wrapped).toContain("def accept(");
    expect(wrapped).toContain("def wrong(");
    expect(wrapped).toContain("def set_score(");
    expect(wrapped).toContain("team_output = _sys.stdin.read()");
    expect(wrapped).toContain("accept('looks good')");
  });
});
