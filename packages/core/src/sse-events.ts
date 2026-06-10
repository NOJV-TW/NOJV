import { z } from "zod";

export const SSE_SUBMISSION_VERDICT = "submission:verdict" as const;
export const SSE_CONTEST_STARTING = "contest:starting" as const;
export const SSE_CONTEST_ENDING = "contest:ending" as const;
export const SSE_ASSIGNMENT_DEADLINE = "assignment:deadline" as const;
export const SSE_NOTIFICATION = "notification" as const;
export const SSE_CLARIFICATION = "clarification" as const;

export interface NotificationSSEEvent {
  type: typeof SSE_NOTIFICATION;
  id: string;
  notificationType: string;
  params: unknown;
  linkUrl: string | null;
  createdAt: string;
}

const submissionVerdictEventSchema = z.object({
  type: z.literal(SSE_SUBMISSION_VERDICT),
  submissionId: z.string(),
  verdict: z.string(),
  score: z.number(),
  problemId: z.string(),
});

const contestStartingEventSchema = z.object({ type: z.literal(SSE_CONTEST_STARTING) });
const contestEndingEventSchema = z.object({ type: z.literal(SSE_CONTEST_ENDING) });
const assignmentDeadlineEventSchema = z.object({ type: z.literal(SSE_ASSIGNMENT_DEADLINE) });

const notificationEventSchema = z.object({
  type: z.literal(SSE_NOTIFICATION),
  id: z.string().optional(), // omitted on batch signals
  notificationType: z.string(),
  params: z.unknown(),
  linkUrl: z.string().nullable(),
  createdAt: z.string().optional(), // omitted on batch signals
});

const clarificationEventSchema = z.object({
  type: z.literal(SSE_CLARIFICATION),
  action: z.enum(["created", "updated", "dismissed", "deleted"]),
  payload: z.object({
    id: z.string(),
    contextType: z.enum(["contest", "exam", "assignment"]),
    contextId: z.string(),
    problemId: z.string().nullable(),
    questionText: z.string(),
    answerText: z.string().nullable(),
    state: z.enum(["pending", "answered", "dismissed"]),
    askedByUserId: z.string().nullable(),
    askedBy: z
      .object({
        id: z.string(),
        username: z.string(),
        name: z.string(),
      })
      .nullable(),
    answeredByUserId: z.string().nullable(),
    answeredBy: z
      .object({
        id: z.string(),
        username: z.string(),
        name: z.string(),
      })
      .nullable(),
    answeredAt: z.string().nullable(),
    createdAt: z.string(),
  }),
});

export const sseEventSchema = z.discriminatedUnion("type", [
  submissionVerdictEventSchema,
  contestStartingEventSchema,
  contestEndingEventSchema,
  assignmentDeadlineEventSchema,
  notificationEventSchema,
  clarificationEventSchema,
]);

export type ClarificationSSEEvent = z.infer<typeof clarificationEventSchema>;
export type SSEEvent = z.infer<typeof sseEventSchema>;
