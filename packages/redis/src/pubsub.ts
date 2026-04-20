import {
  SSE_ASSIGNMENT_DEADLINE,
  SSE_CONTEST_ENDING,
  SSE_CONTEST_STARTING,
  SSE_NOTIFICATION,
  SSE_SUBMISSION_VERDICT,
  type ClarificationSSEEvent,
  type NotificationSSEEvent,
  type SSEEvent,
} from "@nojv/core";

import { getRedis } from "./connection";
import { keys } from "./keys";

function publishEvent(channel: string, event: SSEEvent): Promise<number> {
  return getRedis().publish(channel, JSON.stringify(event));
}

export async function publishVerdict(submission: {
  id: string;
  problemId: string;
  score: number;
  status: string;
  userId: string;
}): Promise<void> {
  try {
    await publishEvent(keys.userChannel(submission.userId), {
      type: SSE_SUBMISSION_VERDICT,
      submissionId: submission.id,
      verdict: submission.status,
      score: submission.score,
      problemId: submission.problemId,
    });
  } catch {
    // Notifications are best-effort; swallow publish failures.
  }
}

export async function publishContestEvent(
  contestId: string,
  eventType: "starting" | "ending",
): Promise<void> {
  const event: SSEEvent =
    eventType === "starting" ? { type: SSE_CONTEST_STARTING } : { type: SSE_CONTEST_ENDING };

  try {
    await publishEvent(keys.contestChannel(contestId), event);
  } catch {
    // best-effort; swallow publish failures.
  }
}

export async function publishAssessmentDeadline(assessmentId: string): Promise<void> {
  try {
    await publishEvent(keys.assessmentChannel(assessmentId), {
      type: SSE_ASSIGNMENT_DEADLINE,
    });
  } catch {
    // best-effort; swallow publish failures.
  }
}

export async function publishNotification(
  userId: string,
  event: NotificationSSEEvent,
): Promise<void> {
  try {
    await publishEvent(keys.notificationChannel(userId), event);
  } catch {
    // Best-effort: SSE delivery is eventually consistent with the DB.
    // If Redis is down, the DB row persists and clients re-fetch on load.
  }
}

export async function publishClarification(
  contextType: string,
  contextId: string,
  event: ClarificationSSEEvent,
): Promise<void> {
  try {
    await publishEvent(keys.clarificationChannel(contextType, contextId), event);
  } catch {
    // Best-effort: SSE delivery is eventually consistent with the DB.
    // If Redis is down, the row is still in the DB and clients re-fetch
    // on reconnect via the `since` query param.
  }
}

// Batch fan-out signal: a "something happened, re-fetch" ping without
// the full payload. Used by createNotificationBatch where the per-row
// SSE round-trip would be expensive.
export async function publishNotificationBatchSignal(
  userId: string,
  detail: { notificationType: string; params: unknown; linkUrl: string | null },
): Promise<void> {
  try {
    await publishEvent(keys.notificationChannel(userId), {
      type: SSE_NOTIFICATION,
      notificationType: detail.notificationType,
      params: detail.params,
      linkUrl: detail.linkUrl,
      // id + createdAt intentionally omitted — the client refetches on
      // any payload missing an id.
    } as NotificationSSEEvent);
  } catch {
    // Best-effort
  }
}
