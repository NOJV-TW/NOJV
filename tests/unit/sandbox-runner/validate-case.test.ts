import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  validateCase,
  validatorTimeoutMs,
} from "../../../apps/sandbox-runner/src/judges/validate.js";

const NODE_VALIDATOR = `const fs = require("fs");
const [, , inputF, answerF, fbDir] = process.argv;
const answer = fs.readFileSync(answerF, "utf8").trim();
const team = fs.readFileSync(0, "utf8").trim();
if (team === answer) {
  fs.writeFileSync(fbDir + "/teammessage.txt", "exact match");
  process.exit(42);
}
if (answer.startsWith(team) && team.length > 0) {
  fs.writeFileSync(fbDir + "/score.txt", "0.5");
  fs.writeFileSync(fbDir + "/teammessage.txt", "partial");
  process.exit(43);
}
fs.writeFileSync(fbDir + "/judgemessage.txt", "secret: " + answer);
process.exit(43);
`;

let workDir: string;
let caseDir: string;
let feedbackDir: string;
let validatorFile: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "validate-case-"));
  caseDir = join(workDir, "case");
  feedbackDir = join(workDir, "feedback");
  await mkdir(caseDir, { recursive: true });
  await mkdir(feedbackDir, { recursive: true });
  validatorFile = join(workDir, "validator.js");
  await writeFile(validatorFile, NODE_VALIDATOR);
  await writeFile(join(caseDir, "input.txt"), "10\n");
  await writeFile(join(caseDir, "answer.txt"), "hello world\n");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

function run(teamOutput: string) {
  return validateCase(
    ["node", validatorFile],
    {
      inputFile: join(caseDir, "input.txt"),
      answerFile: join(caseDir, "answer.txt"),
      teamOutput,
    },
    feedbackDir,
    3,
    10_000,
  );
}

describe("validateCase", () => {
  it("exit 42 → AC and surfaces teammessage", async () => {
    const outcome = await run("hello world\n");
    expect(outcome.index).toBe(3);
    expect(outcome.verdict).toBe("AC");
    expect(outcome.teamMessage).toBe("exact match");
  });

  it("exit 43 with score.txt → WA carrying a partial score", async () => {
    const outcome = await run("hello\n");
    expect(outcome.verdict).toBe("WA");
    expect(outcome.score).toBe(50);
    expect(outcome.teamMessage).toBe("partial");
  });

  it("exit 43 with only a judgemessage → WA, judgeMessage kept separate", async () => {
    const outcome = await run("nope\n");
    expect(outcome.verdict).toBe("WA");
    expect(outcome.judgeMessage).toContain("secret");
    expect(outcome.teamMessage).toBeUndefined();
  });

  it("validator spawn failure → SE", async () => {
    const outcome = await validateCase(
      ["/nonexistent/validator"],
      {
        inputFile: join(caseDir, "input.txt"),
        answerFile: join(caseDir, "answer.txt"),
        teamOutput: "x",
      },
      feedbackDir,
      0,
      10_000,
    );
    expect(outcome.verdict).toBe("SE");
    expect(outcome.judgeMessage).toMatch(/failed to start/i);
  });

  it("non-42/43 exit code → SE", async () => {
    const crashValidator = join(workDir, "crash.js");
    await writeFile(crashValidator, "process.exit(1);");
    const outcome = await validateCase(
      ["node", crashValidator],
      {
        inputFile: join(caseDir, "input.txt"),
        answerFile: join(caseDir, "answer.txt"),
        teamOutput: "x",
      },
      feedbackDir,
      0,
      10_000,
    );
    expect(outcome.verdict).toBe("SE");
  });
});

describe("validatorTimeoutMs", () => {
  it("floors at 30s and scales up with the solution limit", () => {
    expect(validatorTimeoutMs(1_000)).toBe(30_000);
    expect(validatorTimeoutMs(45_000)).toBe(45_000);
  });
});
