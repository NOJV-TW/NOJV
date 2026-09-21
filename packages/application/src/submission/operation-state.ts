import {
  isSubmissionPending,
  submissionOperationStatusSchema,
  submissionResultVerdictSchema,
  verdictSummarySchema,
  type SubmissionResult,
} from "@nojv/core";

export interface SubmissionStateRow {
  id: string;
  status: string;
  judgeGeneration: number;
  updatedAt: Date;
  score: number;
  runtimeMs: number | null;
  memoryKb?: number | null;
  verdictSummary: unknown;
}

export function submissionSummaryResult(row: SubmissionStateRow): SubmissionResult | null {
  const status = submissionOperationStatusSchema.parse(row.status);
  if (isSubmissionPending(status)) return null;
  const verdict = submissionResultVerdictSchema.parse(status);
  const parsed = verdictSummarySchema.safeParse(row.verdictSummary);
  const summary = parsed.success ? parsed.data : null;
  return {
    accepted: verdict === "accepted",
    verdict,
    score: verdict === "system_error" ? 0 : row.score,
    runtimeMs: verdict === "system_error" ? 0 : (row.runtimeMs ?? 0),
    ...(verdict === "system_error" || row.memoryKb === null || row.memoryKb === undefined
      ? {}
      : { memoryKb: row.memoryKb }),
    feedback:
      summary?.compilerErrorTruncated ??
      summary?.systemErrorTruncated ??
      (verdict === "accepted" ? "Accepted." : "Verdict details unavailable."),
  };
}
