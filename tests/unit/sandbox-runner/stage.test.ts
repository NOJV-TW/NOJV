import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { judgeStage } from "../../../apps/sandbox-runner/src/judges/judge-stage.js";
import { runStage } from "../../../apps/sandbox-runner/src/judges/run-stage.js";
import type { SandboxInput } from "../../../apps/sandbox-runner/src/types.js";

const SOLUTION = [
  "const fs = require('node:fs');",
  "const fresh = !fs.existsSync('marker');",
  "fs.writeFileSync('marker', '');",
  "const n = Number(fs.readFileSync(0, 'utf8'));",
  "process.stdout.write(fresh ? String(n + 1) + '\\n' : 'reused\\n');",
].join("");

let root: string;
let submissionDir: string;
let workspaceDir: string;
let outputDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nojv-stage-"));
  [submissionDir, workspaceDir, outputDir] = await Promise.all(
    ["submission", "workspace", "outputs"].map((name) => mkdtemp(join(root, `${name}-`))),
  );
  await Promise.all(
    [1, 5, 9].map((value, index) =>
      writeFile(join(submissionDir, `testcase-${String(index)}-input.txt`), `${value}\n`),
    ),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function config(overrides: Partial<SandboxInput> = {}): SandboxInput {
  return {
    submissionId: "stage",
    language: "javascript",
    judgeType: "standard",
    problemType: "full_source",
    limits: { timeoutMs: 5_000, memoryMb: 256 },
    ...overrides,
  };
}

async function runAll() {
  return runStage({
    runCommand: [process.execPath, "-e", SOLUTION],
    caseIndices: [0, 1, 2],
    parallelism: 2,
    timeoutMs: 5_000,
    memoryLimitMb: 256,
    submissionDir,
    workspaceDir,
    outputDir,
  });
}

async function judgeWithAnswers(answers: string[]) {
  const judgeDir = await mkdtemp(join(root, "judge-"));
  await Promise.all(
    answers.map((answer, index) =>
      writeFile(join(judgeDir, `case-${String(index)}-answer.txt`), answer),
    ),
  );
  return judgeStage({
    config: config(),
    submissionDir: judgeDir,
    outputDir,
    artifactDir: judgeDir,
    workDir: judgeDir,
  });
}

describe("runStage", () => {
  it("runs every case in its own scratch directory and keeps case order", async () => {
    const runs = await runAll();
    expect(runs.map(({ index, stdout }) => [index, stdout])).toEqual([
      [0, "2\n"],
      [1, "6\n"],
      [2, "10\n"],
    ]);
  });
});

describe("judgeStage", () => {
  it("compares each case's recorded output with its answer", async () => {
    await runAll();
    expect(await judgeWithAnswers(["2", "7\n", "10\n"])).toEqual({
      validatorOutcomes: [
        { index: 0, verdict: "AC" },
        { index: 1, verdict: "WA" },
        { index: 2, verdict: "AC" },
      ],
    });
  });

  it("skips cases without an answer", async () => {
    await runAll();
    expect(await judgeWithAnswers(["2\n"])).toEqual({
      validatorOutcomes: [{ index: 0, verdict: "AC" }],
    });
  });

  it("does not trust an output rewritten after its run finished", async () => {
    await runAll();
    await writeFile(join(outputDir, "case-1.out"), "6\n\n");
    const { validatorOutcomes } = await judgeWithAnswers(["2\n", "6\n", "10\n"]);
    expect(validatorOutcomes?.[1]).toMatchObject({ index: 1, verdict: "WA" });
    expect(validatorOutcomes?.[1]?.judgeMessage).toMatch(/changed after its run/);
  });
});
