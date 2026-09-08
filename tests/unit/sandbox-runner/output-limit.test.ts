import { MAX_EXECUTION_OUTPUT_BYTES } from "@nojv/core";
import { expect, it } from "vitest";
import {
  classifySolutionVerdict,
  runProcess,
} from "../../../apps/sandbox-runner/src/judges/run-process";
import { validateCase } from "../../../apps/sandbox-runner/src/judges/validate";

function command(stdoutBytes: number, stderrBytes: number, exitCode = 0): string[] {
  return [
    process.execPath,
    "-e",
    `const fs = require('node:fs'); fs.writeFileSync(1, Buffer.alloc(${stdoutBytes}, 97)); fs.writeFileSync(2, Buffer.alloc(${stderrBytes}, 98)); process.exit(${exitCode});`,
  ];
}

it.each([
  { label: "stdout", stdout: MAX_EXECUTION_OUTPUT_BYTES + 1, stderr: 0 },
  { label: "stderr", stdout: 0, stderr: MAX_EXECUTION_OUTPUT_BYTES + 1 },
  {
    label: "combined streams",
    stdout: MAX_EXECUTION_OUTPUT_BYTES / 2,
    stderr: MAX_EXECUTION_OUTPUT_BYTES / 2 + 1,
  },
])("stops excessive $label with RE and bounded captured output", async ({ stdout, stderr }) => {
  const result = await runProcess(command(stdout, stderr), { timeoutMs: 5000 });
  expect(result.outputLimitExceeded).toBe(true);
  expect(result.stderr).toMatch(/^Output limit exceeded\./);
  expect(classifySolutionVerdict(result, 0)?.verdict).toBe("RE");
  expect(
    Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
  ).toBeLessThanOrEqual(MAX_EXECUTION_OUTPUT_BYTES + 23);
});

it("allows exactly the combined execution output cap", async () => {
  const result = await runProcess(
    command(MAX_EXECUTION_OUTPUT_BYTES / 2, MAX_EXECUTION_OUTPUT_BYTES / 2),
    { timeoutMs: 5000 },
  );
  expect(result.outputLimitExceeded).toBe(false);
  expect(result.exitCode).toBe(0);
  expect(classifySolutionVerdict(result, 0)).toBeNull();
});

it("reports validator output overflow as SE rather than accepting its exit code", async () => {
  const result = await validateCase(
    command(MAX_EXECUTION_OUTPUT_BYTES + 1, 0, 42),
    { inputFile: "unused", answerFile: "unused", teamOutput: "" },
    "unused",
    0,
    5000,
  );
  expect(result).toEqual({
    index: 0,
    verdict: "SE",
    judgeMessage: "Validator output limit exceeded.",
  });
});
