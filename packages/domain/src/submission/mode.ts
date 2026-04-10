import type { SubmissionMode } from "@nojv/core";

// Contest wins over assignment — a submission carrying a contestId is always
// contest-mode even if courseAssessmentId is also set.
export function deriveSubmissionMode(s: {
  contestId: string | null;
  courseAssessmentId: string | null;
}): SubmissionMode {
  if (s.contestId) return "contest";
  if (s.courseAssessmentId) return "assignment";
  return "practice";
}
