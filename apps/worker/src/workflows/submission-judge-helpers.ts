export type ScoringDispatch =
  | { kind: "contest"; contestParticipationId: string }
  | { kind: "exam"; examId: string; userId: string }
  | { kind: "none" };

export function resolveScoringDispatch(submission: {
  contestParticipationId: string | null;
  examId: string | null;
  userId: string;
}): ScoringDispatch {
  if (submission.contestParticipationId) {
    return { kind: "contest", contestParticipationId: submission.contestParticipationId };
  }
  if (submission.examId) {
    return { kind: "exam", examId: submission.examId, userId: submission.userId };
  }
  return { kind: "none" };
}
