import {
  INTERACTIVE_RUN_MARKER,
  INTERACTIVE_VALIDATE_MARKER,
  parseMarkedLine,
  type InteractiveRunReport,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type ValidatorOutcome,
} from "@nojv/core";

export interface InteractiveSideResult {
  stderr: string;
  timedOut: boolean;
  spawnError: boolean;
}

export function mergeInteractiveCase(
  testcase: SandboxTestcase,
  sol: InteractiveSideResult,
  int: InteractiveSideResult,
): SandboxTestcaseResult {
  const se = (stderr: string, feedback: string): SandboxTestcaseResult => ({
    index: testcase.index,
    verdict: "SE",
    stdout: "",
    stderr,
    exitCode: -1,
    timeMs: 0,
    feedback,
  });

  if (sol.timedOut || int.timedOut)
    return se("Interactive run timed out.", "Interactive run timed out.");
  if (sol.spawnError) return se(sol.stderr, "Sandbox failed to start.");
  if (int.spawnError) return se(int.stderr, "Interactor failed to start (system error).");

  const run = parseMarkedLine(
    sol.stderr,
    INTERACTIVE_RUN_MARKER,
  ) as InteractiveRunReport | null;
  const outcome = parseMarkedLine(
    int.stderr,
    INTERACTIVE_VALIDATE_MARKER,
  ) as ValidatorOutcome | null;

  if (!run) return se(sol.stderr, "Interactive run produced no result (system error).");

  const base = {
    index: testcase.index,
    stdout: "",
    stderr: run.stderr ?? "",
    exitCode: run.exitCode,
    timeMs: run.timeMs,
    ...(run.memoryKb !== undefined && run.memoryKb > 0 ? { memoryKb: run.memoryKb } : {}),
  };

  if (run.errorVerdict) {
    return { ...base, verdict: run.errorVerdict };
  }

  if (!outcome || outcome.verdict === "SE") {
    return {
      ...base,
      verdict: "SE",
      feedback: "Interactor did not report a verdict.",
    };
  }

  return {
    ...base,
    verdict: outcome.verdict,
    ...(outcome.teamMessage !== undefined ? { feedback: outcome.teamMessage } : {}),
    ...(outcome.judgeMessage !== undefined ? { staffFeedback: outcome.judgeMessage } : {}),
  };
}
