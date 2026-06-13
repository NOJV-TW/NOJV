import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compileInteractor } from "../../../apps/sandbox-runner/src/compiler.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "interactor-compile-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

describe("compileInteractor (python)", () => {
  it("prepends the DOMjudge interactor wrapper and runs via python3", async () => {
    const src = join(workDir, "interactor.src.py");
    await writeFile(src, "accept('done')\n");

    const result = await compileInteractor(src, "python", workDir);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.runCommand[0]).toBe("python3");
    const wrapped = await readFile(result.runCommand[1]!, "utf8");
    expect(wrapped).toContain("def read(");
    expect(wrapped).toContain("def write(");
    expect(wrapped).toContain("_sys.stdin.readline()");
    expect(wrapped).toContain("print(msg, flush=True)");
    expect(wrapped).toContain("def accept(");
    expect(wrapped).toContain("def wrong(");
    expect(wrapped).toContain("_sys.exit(42)");
    expect(wrapped).toContain("_sys.exit(43)");
    expect(wrapped).not.toContain("team_output = _sys.stdin.read()");
    expect(wrapped).toContain("accept('done')");
  });
});
