import {
  INTERACTIVE_RUN_MARKER,
  INTERACTIVE_VALIDATE_MARKER,
  parseMarkedLine,
  type InteractiveRunReport,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type ValidatorOutcome,
} from "@nojv/core";

/** One container's outcome from an interactive run (solution OR interactor). */
export interface InteractiveSideResult {
  stderr: string;
  timedOut: boolean;
  spawnError: boolean;
}

/**
 * Merge one case's two-container outcome into a single result. A solution-side
 * run failure (TLE/MLE/RE/SE) wins with score 0; otherwise the interactor's
 * `ValidatorOutcome` decides verdict/score. `teamMessage` becomes the student
 * `feedback`; `judgeMessage` becomes the staff-only `staffFeedback` (gated
 * downstream so it never reaches the student). A missing/unparseable marker on
 * either side, or a container timeout, is SE for the case.
 *
 * Shared by the Docker interactive executor and the K8s interactive executor —
 * both backends ship the same `InteractiveSideResult` shape (each side's
 * captured stderr + spawn/timeout flags) so the merge logic stays single-source.
 */
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
    score: 0,
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
    return { ...base, verdict: run.errorVerdict, score: 0 };
  }

  if (!outcome || outcome.verdict === "SE") {
    return {
      ...base,
      verdict: "SE",
      score: 0,
      feedback: "Interactor did not report a verdict.",
    };
  }

  const score = outcome.score ?? (outcome.verdict === "AC" ? 100 : 0);
  return {
    ...base,
    verdict: outcome.verdict,
    score,
    ...(outcome.teamMessage !== undefined ? { feedback: outcome.teamMessage } : {}),
    ...(outcome.judgeMessage !== undefined ? { staffFeedback: outcome.judgeMessage } : {}),
  };
}
