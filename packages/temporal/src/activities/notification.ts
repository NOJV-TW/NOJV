import {
  SSE_ASSIGNMENT_DEADLINE,
  SSE_CONTEST_ENDING,
  SSE_CONTEST_STARTING,
  SSE_SUBMISSION_VERDICT,
  userChannel,
  type SSEEvent
} from "@nojv/core";

import { getRedis } from "./redis";

function publishEvent(channel: string, event: SSEEvent): Promise<number> {
  return getRedis().publish(channel, JSON.stringify(event));
}

export async function publishVerdict(submission: {
  id: string;
  problemId: string;
  problemSlug: string;
  score: number;
  status: string;
  userId: string;
}): Promise<void> {
  try {
    await publishEvent(userChannel(submission.userId), {
      type: SSE_SUBMISSION_VERDICT,
      submissionId: submission.id,
      verdict: submission.status,
      score: submission.score,
      problemId: submission.problemId,
      problemSlug: submission.problemSlug
    });
  } catch {
    // Non-critical: don't fail the activity if publish fails
  }
}

export async function publishContestEvent(
  contestId: string,
  eventType: "starting" | "ending"
): Promise<void> {
  const event: SSEEvent =
    eventType === "starting" ? { type: SSE_CONTEST_STARTING } : { type: SSE_CONTEST_ENDING };

  try {
    await publishEvent(`contest:${contestId}`, event);
  } catch {
    // Non-critical
  }
}

export async function publishAssessmentDeadline(assessmentId: string): Promise<void> {
  try {
    await publishEvent(`assessment:${assessmentId}`, {
      type: SSE_ASSIGNMENT_DEADLINE
    });
  } catch {
    // Non-critical
  }
}
