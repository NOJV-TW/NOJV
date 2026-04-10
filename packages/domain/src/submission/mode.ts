import type { SubmissionMode } from "@nojv/core";

/**
 * Derive a submission's mode from its context columns. The `Submission.mode`
 * column was removed in the second-pass refactor — context is the single
 * source of truth. Order matters: a submission carrying a contestId is
 * always contest-mode even if courseAssessmentId is also set.
 */
export function deriveSubmissionMode(s: {
  contestId: string | null;
  courseAssessmentId: string | null;
}): SubmissionMode {
  if (s.contestId) return "contest";
  if (s.courseAssessmentId) return "assignment";
  return "practice";
}
