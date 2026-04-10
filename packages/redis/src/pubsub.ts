import {
  SSE_ASSIGNMENT_DEADLINE,
  SSE_CONTEST_ENDING,
  SSE_CONTEST_STARTING,
  SSE_SUBMISSION_VERDICT,
  type SSEEvent
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
      problemId: submission.problemId
    });
  } catch {
    // Notifications are best-effort; swallow publish failures.
  }
}

export async function publishContestEvent(
  contestId: string,
  eventType: "starting" | "ending"
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
      type: SSE_ASSIGNMENT_DEADLINE
    });
  } catch {
    // best-effort; swallow publish failures.
  }
}
