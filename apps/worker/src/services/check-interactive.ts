import {
  parseInteractiveRunReport,
  parseInteractiveValidatorReport,
  type SandboxTestcase,
  type SandboxTestcaseResult,
} from "@nojv/core";

import { errorVerdictFeedback } from "./check-standard";

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

  const run = parseInteractiveRunReport(sol.stderr);
  const outcome = parseInteractiveValidatorReport(int.stderr);

  if (!run) return se(sol.stderr, "Interactive run produced no result (system error).");

  const base = {
    index: testcase.index,
    stdout: "",
    stderr: run.stderr ?? "",
    exitCode: run.exitCode,
    timeMs: run.timeMs,
    ...(run.memoryKb !== undefined && run.memoryKb > 0 ? { memoryKb: run.memoryKb } : {}),
  };

  if (outcome?.verdict === "SE") {
    return {
      ...base,
      verdict: "SE",
      feedback: "Interactive judge failed; this submission was not counted.",
      ...(outcome.judgeMessage ? { staffFeedback: outcome.judgeMessage } : {}),
    };
  }

  if (run.errorVerdict) {
    const feedback = errorVerdictFeedback(run.errorVerdict, run.stderr ?? "");
    return {
      ...base,
      verdict: run.errorVerdict,
      ...(feedback !== undefined ? { feedback } : {}),
    };
  }

  if (!outcome) {
    return {
      ...base,
      verdict: "SE",
      feedback: "Interactive judge failed; this submission was not counted.",
    };
  }

  return {
    ...base,
    verdict: outcome.verdict,
    ...(outcome.teamMessage !== undefined ? { feedback: outcome.teamMessage } : {}),
    ...(outcome.judgeMessage !== undefined ? { staffFeedback: outcome.judgeMessage } : {}),
  };
}
