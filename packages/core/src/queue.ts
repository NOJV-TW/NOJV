import { z } from "zod";

import { submissionDraftSchema } from "./schemas/submission";

export const SSE_SUBMISSION_VERDICT = "submission:verdict" as const;
export const SSE_CONTEST_STARTING = "contest:starting" as const;
export const SSE_CONTEST_ENDING = "contest:ending" as const;
export const SSE_ASSIGNMENT_DEADLINE = "assignment:deadline" as const;

export function userChannel(userId: string): string {
  return `user:${userId}`;
}

const submissionVerdictEventSchema = z.object({
  type: z.literal(SSE_SUBMISSION_VERDICT),
  submissionId: z.string(),
  verdict: z.string(),
  score: z.number(),
  problemId: z.string()
});

const contestStartingEventSchema = z.object({ type: z.literal(SSE_CONTEST_STARTING) });
const contestEndingEventSchema = z.object({ type: z.literal(SSE_CONTEST_ENDING) });
const assignmentDeadlineEventSchema = z.object({ type: z.literal(SSE_ASSIGNMENT_DEADLINE) });

export const sseEventSchema = z.discriminatedUnion("type", [
  submissionVerdictEventSchema,
  contestStartingEventSchema,
  contestEndingEventSchema,
  assignmentDeadlineEventSchema
]);

export type SubmissionVerdictEvent = z.infer<typeof submissionVerdictEventSchema>;
export type ContestStartingEvent = z.infer<typeof contestStartingEventSchema>;
export type ContestEndingEvent = z.infer<typeof contestEndingEventSchema>;
export type AssignmentDeadlineEvent = z.infer<typeof assignmentDeadlineEventSchema>;
export type SSEEvent = z.infer<typeof sseEventSchema>;

export const submissionJudgeJobSchema = z.object({
  draft: submissionDraftSchema,
  submissionId: z.string().trim().min(1)
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;

interface RedisConnectionOptions {
  host: string;
  password: string | undefined;
  port: number;
}

export function parseRedisConnection(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    password: url.password || undefined,
    port: Number(url.port || "6379")
  };
}
