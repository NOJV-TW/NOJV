import { MAX_FEEDBACK_LEN } from "../schemas/submission";
import { parseValidatorFeedback } from "./validator";
import { wasmOjTerminationVerdict } from "./wasm-oj-verdict";

type TestJudgeVerdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "SE";

interface ProcessTermination {
  termination: string;
  code: number;
}

export function truncateUtf8(text: string, maxBytes: number): string {
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(maxBytes));
  return text.slice(0, read);
}

function capFeedback(text: string): string {
  if (text.length <= MAX_FEEDBACK_LEN) return text;
  const last = text.charCodeAt(MAX_FEEDBACK_LEN - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? MAX_FEEDBACK_LEN - 1 : MAX_FEEDBACK_LEN);
}

export function checkerCaseVerdict(
  { code, termination }: ProcessTermination,
  teamMessage?: string,
): { verdict: Extract<TestJudgeVerdict, "AC" | "WA" | "SE">; teamMessage?: string } {
  if (termination !== "exited") return { verdict: "SE" };
  const outcome = parseValidatorFeedback(
    code,
    teamMessage === undefined ? {} : { teamMessage },
  );
  if (outcome.verdict === "SE" || outcome.teamMessage === undefined) {
    return { verdict: outcome.verdict };
  }
  return { verdict: outcome.verdict, teamMessage: capFeedback(outcome.teamMessage) };
}

export function interactiveCaseVerdict(
  result: { contestant: ProcessTermination; interactor: ProcessTermination },
  teamMessage?: string,
): { verdict: TestJudgeVerdict; teamMessage?: string } {
  const interactor = checkerCaseVerdict(result.interactor, teamMessage);
  if (interactor.verdict === "SE") return interactor;
  const contestant = wasmOjTerminationVerdict(
    result.contestant.termination,
    result.contestant.code,
  );
  return contestant === "AC" ? interactor : { verdict: contestant };
}
