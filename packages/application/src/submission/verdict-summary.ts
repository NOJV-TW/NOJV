import type { SubmissionResult, VerdictSummary } from "@nojv/core";

const SUMMARY_VERDICTS = new Set(["AC", "WA", "TLE", "MLE", "RE"]);

export function deriveSystemErrorVerdictSummary(reason: string): VerdictSummary {
  return {
    caseSummary: { ac: 0, wa: 0, tle: 0, mle: 0, re: 0, other: 0 },
    systemErrorTruncated: (
      reason.trim() || "Judge pipeline failed without an error message."
    ).slice(0, 1024),
  };
}

export function deriveVerdictSummary(result: SubmissionResult): VerdictSummary {
  const caseSummary = { ac: 0, wa: 0, tle: 0, mle: 0, re: 0, other: 0 };
  for (const c of result.caseResults ?? []) {
    const v = c.verdict.toUpperCase();
    if (SUMMARY_VERDICTS.has(v)) {
      if (v === "AC") caseSummary.ac += 1;
      else if (v === "WA") caseSummary.wa += 1;
      else if (v === "TLE") caseSummary.tle += 1;
      else if (v === "MLE") caseSummary.mle += 1;
      else if (v === "RE") caseSummary.re += 1;
    } else {
      caseSummary.other += 1;
    }
  }

  const summary: VerdictSummary = { caseSummary };

  if (result.subtaskResults && result.subtaskResults.length > 0) {
    summary.subtaskSummary = result.subtaskResults.map((s) => ({
      id: s.testcaseSetId,
      score: s.rawScore ?? (s.passed ? s.weight : 0),
    }));
  }

  if (result.verdict === "compile_error" && result.feedback) {
    summary.compilerErrorTruncated = result.feedback.slice(0, 1024);
  }

  if (result.verdict === "system_error" && result.feedback) {
    summary.systemErrorTruncated = result.feedback.slice(0, 1024);
  }

  return summary;
}
