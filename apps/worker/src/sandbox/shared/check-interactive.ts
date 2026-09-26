import {
  parseInteractiveRunReports,
  parseInteractiveValidatorReports,
  type InteractiveRunReport,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type ValidatorOutcome,
} from "@nojv/core";

import { errorVerdictFeedback } from "./check-standard";

export interface InteractiveSideResult {
  stderr: string;
  timedOut: boolean;
  spawnError: boolean;
}

function mergeInteractiveCase(
  testcase: SandboxTestcase,
  sol: InteractiveSideResult,
  int: InteractiveSideResult,
  run: InteractiveRunReport | undefined,
  outcome: ValidatorOutcome | undefined,
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

  if (outcome?.verdict === "SE") {
    return {
      ...se(run?.stderr ?? "", "Interactive judge failed; this submission was not counted."),
      ...(outcome.judgeMessage ? { staffFeedback: outcome.judgeMessage } : {}),
    };
  }
  if (!run) {
    if (outcome?.verdict === "WA")
      return {
        ...se("", ""),
        verdict: "WA",
        ...(outcome.judgeMessage ? { staffFeedback: outcome.judgeMessage } : {}),
        feedback: outcome.teamMessage ?? "Wrong answer.",
      };
    return se(sol.stderr, "Interactive run produced no result (system error).");
  }

  const base = {
    index: testcase.index,
    stdout: "",
    stderr: run.stderr ?? "",
    exitCode: run.exitCode,
    timeMs: run.timeMs,
    ...(run.memoryKb !== undefined && run.memoryKb > 0 ? { memoryKb: run.memoryKb } : {}),
  };

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

export function resolveInteractiveStage(
  testcases: SandboxTestcase[],
  sol: InteractiveSideResult,
  int: InteractiveSideResult,
): SandboxResult {
  const runs = parseInteractiveRunReports(sol.stderr);
  if (!sol.timedOut && !sol.spawnError && !int.timedOut && !int.spawnError) {
    const compilationError = runs.find(
      (run) => run.compilationError !== undefined,
    )?.compilationError;
    if (compilationError !== undefined) return { testcaseResults: [], compilationError };
  }
  const runByIndex = new Map(
    runs.flatMap((run) => (run.index === undefined ? [] : [[run.index, run] as const])),
  );
  const outcomeByIndex = new Map(
    parseInteractiveValidatorReports(int.stderr).flatMap(({ index, ...outcome }) =>
      index === undefined ? [] : [[index, outcome] as const],
    ),
  );
  return {
    testcaseResults: testcases.map((testcase) =>
      mergeInteractiveCase(
        testcase,
        sol,
        int,
        runByIndex.get(testcase.index),
        outcomeByIndex.get(testcase.index),
      ),
    ),
  };
}
