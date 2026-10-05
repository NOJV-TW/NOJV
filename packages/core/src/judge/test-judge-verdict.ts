import { MAX_FEEDBACK_LEN } from "../schemas/submission";
import { parseValidatorFeedback } from "./validator";
import { wasmOjTerminationVerdict } from "./wasm-oj-verdict";

interface ProcessTermination {
  termination: string;
  code: number;
}

export function truncateUtf8(text: string, maxBytes: number): string {
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(maxBytes));
  return text.slice(0, read);
}

export function checkerCaseVerdict(
  exitCode: number,
  termination: string,
  teamMessage?: string,
): { verdict: "AC" | "WA" | "SE"; teamMessage?: string } {
  if (termination !== "exited") return { verdict: "SE" };
  const outcome = parseValidatorFeedback(
    exitCode,
    teamMessage === undefined ? {} : { teamMessage },
  );
  if (outcome.verdict === "SE" || outcome.teamMessage === undefined) {
    return { verdict: outcome.verdict };
  }
  return {
    verdict: outcome.verdict,
    teamMessage: truncateUtf8(outcome.teamMessage, MAX_FEEDBACK_LEN),
  };
}

export function interactiveCaseVerdict(
  result: { contestant: ProcessTermination; interactor: ProcessTermination },
  teamMessage?: string,
): { verdict: "AC" | "WA" | "TLE" | "MLE" | "RE" | "SE"; teamMessage?: string } {
  const interactor = checkerCaseVerdict(
    result.interactor.code,
    result.interactor.termination,
    teamMessage,
  );
  if (interactor.verdict === "SE") return interactor;
  const contestant = wasmOjTerminationVerdict(
    result.contestant.termination,
    result.contestant.code,
  );
  return contestant === "AC" ? interactor : { verdict: contestant };
}
