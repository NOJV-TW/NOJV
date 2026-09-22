import {
  cleanupUnreferencedStorageObject,
  executeLifecycleCancellation,
  examDomain,
  LIFECYCLE_CANCELLATION_WORK_KIND,
  lifecycleCancellationPayloadSchema,
  notificationDomain,
  scoreOverrideDomain,
  STORAGE_OBJECT_CLEANUP_KIND,
  submissionDomain,
} from "@nojv/application";
import { JUDGE_EXECUTION_DISPATCH_KIND } from "@nojv/core";
import { z } from "zod";

import type { DurableWorkHandlerRegistry } from "./durable-work-runner";

const notificationSsePayload = z
  .object({
    notificationId: z.string().min(1),
    userId: z.string().min(1),
    event: z
      .object({
        type: z.literal("notification"),
        id: z.string().min(1),
        notificationType: z.string().min(1),
        params: z.unknown(),
        linkUrl: z.string().nullable(),
        createdAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();
const scoreConvergencePayload = z
  .object({
    context: z.object({ type: z.literal("exam"), examId: z.string().min(1) }).strict(),
    userId: z.string().min(1),
  })
  .strict();

export const durableWorkHandlers = Object.freeze({
  [examDomain.credentials.EMAIL_WORK_KIND]: async (payload: unknown) => {
    return examDomain.credentials.deliverEmail(payload);
  },
  [JUDGE_EXECUTION_DISPATCH_KIND]: async (payload: unknown) => {
    await submissionDomain.executeJudgeExecutionDispatch(payload);
    return { outcome: "dispatched" };
  },
  [notificationDomain.NOTIFICATION_SSE_WORK_KIND]: async (payload: unknown) => {
    const parsed = notificationSsePayload.parse(payload);
    return notificationDomain.publishNotificationSse(parsed);
  },
  [notificationDomain.NOTIFICATION_EMAIL_WORK_KIND]: async (payload: unknown) => {
    const parsed = notificationDomain.notificationEmailWorkPayloadSchema.parse(payload);
    return notificationDomain.deliverNotificationEmail(parsed);
  },
  [scoreOverrideDomain.SCORE_CONVERGENCE_WORK_KIND]: async (payload: unknown) => {
    const parsed = scoreConvergencePayload.parse(payload);
    await examDomain.updateExamScores(parsed.context.examId, parsed.userId);
    return { outcome: "converged", contextType: "exam" };
  },
  [LIFECYCLE_CANCELLATION_WORK_KIND]: async (payload: unknown) => {
    await executeLifecycleCancellation(lifecycleCancellationPayloadSchema.parse(payload));
    return { outcome: "cancelled_or_obsolete" };
  },
  [STORAGE_OBJECT_CLEANUP_KIND]: async (payload: unknown) => {
    await cleanupUnreferencedStorageObject(payload);
    return { outcome: "deleted_or_still_referenced" };
  },
  [submissionDomain.SUBMISSION_JUDGE_DISPATCH_WORK_KIND]: async (payload: unknown) => {
    await submissionDomain.executeSubmissionJudgeDispatch(payload);
    return { outcome: "dispatched" };
  },
  [submissionDomain.REJUDGE_DISPATCH_WORK_KIND]: async (payload: unknown) => {
    await submissionDomain.executeRejudgeDispatch(payload);
    return { outcome: "dispatched" };
  },
}) satisfies DurableWorkHandlerRegistry;
