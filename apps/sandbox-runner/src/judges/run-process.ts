import { spawn } from "node:child_process";

export interface RunProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  timedOut: boolean;
  signal: string | null;
  spawnError: boolean;
}

/**
 * Spawn a child process, optionally feed stdin, collect stdout/stderr,
 * and enforce a timeout with a fallback SIGKILL.
 */
export function runProcess(
  command: string[],
  options: { stdin?: string; timeoutMs: number }
): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const [cmd, ...args] = command;

    if (!cmd) {
      resolve({
        stdout: "",
        stderr: "Empty run command.",
        exitCode: -1,
        timeMs: 0,
        timedOut: false,
        signal: null,
        spawnError: true
      });
      return;
    }

    const useStdin = options.stdin !== undefined;

    const proc = spawn(cmd, args, {
      stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
      timeout: options.timeoutMs
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;

    proc.stdout!.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    if (useStdin) {
      proc.stdin!.on("error", () => {}); // Ignore EPIPE when process exits before stdin is consumed
      proc.stdin!.write(options.stdin);
      proc.stdin!.end();
    }

    // Fallback timer in case spawn timeout doesn't fire
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, options.timeoutMs + 500);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      const timeMs = Math.round(performance.now() - startTime);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? -1,
        timeMs,
        timedOut: killed || signal === "SIGTERM" || timeMs >= options.timeoutMs,
        signal,
        spawnError: false
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: `Failed to spawn process: ${err.message}`,
        exitCode: -1,
        timeMs: Math.round(performance.now() - startTime),
        timedOut: false,
        signal: null,
        spawnError: true
      });
    });
  });
}

/**
 * Parse judge process output to determine verdict score and feedback.
 *
 * Used by both checker and interactor judges:
 * - Exit code 0 → accepted
 * - scoreText: integer 0-100 (defaults to 100 if accepted, 0 if rejected)
 * - feedbackText: human-readable feedback string
 */
export function parseJudgeOutput(
  exitCode: number,
  scoreText: string,
  feedbackText: string
): { accepted: boolean; score: number; feedback: string } {
  const accepted = exitCode === 0;
  const feedback = feedbackText.trim();

  const trimmed = scoreText.trim();
  let score: number;
  if (trimmed.length > 0) {
    const parsed = parseInt(trimmed, 10);
    score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : accepted ? 100 : 0;
  } else {
    score = accepted ? 100 : 0;
  }

  return { accepted, score, feedback };
}
