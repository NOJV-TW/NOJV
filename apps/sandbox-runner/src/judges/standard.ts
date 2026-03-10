import { spawn } from "node:child_process";
import type { TestcaseFiles, TestcaseResult } from "../types.js";

/**
 * Normalize program output for comparison:
 * - Convert \r\n → \n
 * - Trim trailing whitespace from each line
 * - Trim trailing newlines
 *
 * Matches the normalization used in the existing submission-runner.
 */
function normalizeOutput(output: string): string {
  return output.replaceAll("\r\n", "\n").trimEnd();
}

/**
 * Standard judge: run the program with testcase input as stdin,
 * compare normalized stdout with expected output.
 */
export function judgeStandard(
  runCommand: string[],
  testcase: TestcaseFiles,
  timeoutMs: number,
): Promise<TestcaseResult> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const [cmd, ...args] = runCommand;

    if (!cmd) {
      resolve({
        index: testcase.index,
        verdict: "SE",
        stdout: "",
        stderr: "Empty run command.",
        exitCode: -1,
        timeMs: 0,
      });
      return;
    }

    const proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // Write testcase input to stdin
    proc.stdin.write(testcase.input);
    proc.stdin.end();

    // Set up a manual timeout as a fallback (spawn timeout may not always fire)
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeoutMs + 500);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      const timeMs = Math.round(performance.now() - startTime);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const exitCode = code ?? -1;

      // TLE: killed by our timer, spawn timeout (SIGTERM), or elapsed time exceeded
      if (killed || signal === "SIGTERM" || timeMs >= timeoutMs) {
        resolve({ index: testcase.index, verdict: "TLE", stdout, stderr, exitCode, timeMs });
        return;
      }

      // MLE: killed by external SIGKILL (e.g. OOM killer) before timeout
      if (signal === "SIGKILL") {
        resolve({ index: testcase.index, verdict: "MLE", stdout, stderr, exitCode, timeMs });
        return;
      }

      // RE: non-zero exit code
      if (exitCode !== 0) {
        resolve({
          index: testcase.index,
          verdict: "RE",
          stdout,
          stderr,
          exitCode,
          timeMs,
        });
        return;
      }

      // Compare output
      const expected = testcase.expected ?? "";
      const verdict =
        normalizeOutput(stdout) === normalizeOutput(expected) ? "AC" : "WA";

      resolve({
        index: testcase.index,
        verdict,
        stdout,
        stderr,
        exitCode,
        timeMs,
        score: verdict === "AC" ? 100 : 0,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      const timeMs = Math.round(performance.now() - startTime);
      resolve({
        index: testcase.index,
        verdict: "SE",
        stdout: "",
        stderr: `Failed to spawn process: ${err.message}`,
        exitCode: -1,
        timeMs,
      });
    });
  });
}
