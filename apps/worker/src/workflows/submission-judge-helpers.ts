export type ScoringDispatch =
  | { kind: "contest"; contestId: string; userId: string }
  | { kind: "exam"; examId: string; userId: string }
  | { kind: "none" };

export function resolveScoringDispatch(submission: {
  contestId: string | null;
  examId: string | null;
  userId: string;
}): ScoringDispatch {
  if (submission.contestId) {
    return { kind: "contest", contestId: submission.contestId, userId: submission.userId };
  }
  if (submission.examId) {
    return { kind: "exam", examId: submission.examId, userId: submission.userId };
  }
  return { kind: "none" };
}
