import {
  SSE_CONTEST_ENDING,
  SSE_CONTEST_STARTING,
  SSE_NOTIFICATION,
  SSE_SCOREBOARD,
  SSE_SUBMISSION_VERDICT,
  type ClarificationSSEEvent,
  type NotificationSSEEvent,
  type SSEEvent,
} from "@nojv/core";

import { getRedis } from "./connection";
import { keys } from "./keys";

const SCOREBOARD_UPDATE_THROTTLE_SECONDS = 10;

export type PubsubOperation =
  | "scoreboard"
  | "verdict"
  | "contest"
  | "notification"
  | "clarification"
  | "notification_batch";

export interface PubsubError {
  operation: PubsubOperation;
  channel: string;
  err: unknown;
}

export type PubsubErrorHandler = (error: PubsubError) => void;

let pubsubErrorHandler: PubsubErrorHandler = ({ operation, channel, err }) => {
  console.error("[redis.pubsub] publish failed", {
    operation,
    channel,
    err: err instanceof Error ? err.message : String(err),
  });
};

export function setPubsubErrorHandler(handler: PubsubErrorHandler): void {
  pubsubErrorHandler = handler;
}

function publishEvent(channel: string, event: SSEEvent): Promise<number> {
  return getRedis().publish(channel, JSON.stringify(event));
}

function bestEffort(
  operation: PubsubOperation,
  channel: string,
  task: () => Promise<unknown>,
): Promise<void> {
  return task().then(
    () => undefined,
    (err: unknown) => {
      pubsubErrorHandler({ operation, channel, err });
    },
  );
}

export async function publishScoreboardUpdate(contestId: string): Promise<void> {
  const channel = keys.contestChannel(contestId);
  await bestEffort("scoreboard", channel, async () => {
    const acquired = await getRedis().set(
      keys.scoreboardUpdateThrottle(contestId),
      "1",
      "EX",
      SCOREBOARD_UPDATE_THROTTLE_SECONDS,
      "NX",
    );
    if (acquired !== "OK") return;
    await publishEvent(channel, { type: SSE_SCOREBOARD });
  });
}

export async function publishVerdict(submission: {
  id: string;
  problemId: string;
  score: number;
  status: string;
  userId: string;
}): Promise<void> {
  const channel = keys.userChannel(submission.userId);
  await bestEffort("verdict", channel, async () => {
    await publishEvent(channel, {
      type: SSE_SUBMISSION_VERDICT,
      submissionId: submission.id,
      verdict: submission.status,
      score: submission.score,
      problemId: submission.problemId,
    });
  });
}

export async function publishContestEvent(
  contestId: string,
  eventType: "starting" | "ending",
): Promise<void> {
  const event: SSEEvent =
    eventType === "starting" ? { type: SSE_CONTEST_STARTING } : { type: SSE_CONTEST_ENDING };

  const channel = keys.contestChannel(contestId);
  await bestEffort("contest", channel, async () => {
    await publishEvent(channel, event);
  });
}

export async function publishNotification(
  userId: string,
  event: NotificationSSEEvent,
): Promise<void> {
  const channel = keys.notificationChannel(userId);
  await bestEffort("notification", channel, async () => {
    await publishEvent(channel, event);
  });
}

export async function publishClarification(
  contextType: string,
  contextId: string,
  event: ClarificationSSEEvent,
  target: "public" | "staff" = "public",
): Promise<void> {
  const channel =
    target === "staff"
      ? keys.clarificationStaffChannel(contextType, contextId)
      : keys.clarificationChannel(contextType, contextId);
  await bestEffort("clarification", channel, async () => {
    await publishEvent(channel, event);
  });
}

export async function publishNotificationBatchSignal(
  userId: string,
  detail: { notificationType: string; params: unknown; linkUrl: string | null },
): Promise<void> {
  const channel = keys.notificationChannel(userId);
  await bestEffort("notification_batch", channel, async () => {
    await publishEvent(channel, {
      type: SSE_NOTIFICATION,
      notificationType: detail.notificationType,
      params: detail.params,
      linkUrl: detail.linkUrl,
    });
  });
}
