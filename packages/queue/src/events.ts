export const SSE_SUBMISSION_VERDICT = "submission:verdict" as const;
export const SSE_CONTEST_STARTING = "contest:starting" as const;
export const SSE_CONTEST_ENDING = "contest:ending" as const;
export const SSE_ASSIGNMENT_DEADLINE = "assignment:deadline" as const;

export function userChannel(userId: string): string {
  return `user:${userId}`;
}

export interface SubmissionVerdictEvent {
  type: typeof SSE_SUBMISSION_VERDICT;
  submissionId: string;
  verdict: string;
  score: number;
  problemId: string;
  problemSlug: string | null;
}

export interface ContestStartingEvent {
  type: typeof SSE_CONTEST_STARTING;
}

export interface ContestEndingEvent {
  type: typeof SSE_CONTEST_ENDING;
}

export interface AssignmentDeadlineEvent {
  type: typeof SSE_ASSIGNMENT_DEADLINE;
}

export type SSEEvent =
  | SubmissionVerdictEvent
  | ContestStartingEvent
  | ContestEndingEvent
  | AssignmentDeadlineEvent;
