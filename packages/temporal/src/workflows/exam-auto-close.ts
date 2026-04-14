import { proxyActivities, sleep } from "@temporalio/workflow";
import type { ExamAutoCloseInput } from "../types";
import type * as examSessionActivities from "../activities/exam-session";
import { SHORT_ACTIVITY } from "./activity-options";
import { computeAutoCloseDelayMs } from "./exam-auto-close-helpers";

const { closeActiveSessionsForExam } =
  proxyActivities<typeof examSessionActivities>(SHORT_ACTIVITY);

/**
 * Durable timer that sleeps until `exam.endsAt` and then auto-closes
 * every still-active session for the exam. Survives worker restarts —
 * the sleep is checkpointed in Temporal history.
 *
 * If `endsAt` is already in the past when the workflow starts (e.g.
 * an exam published with an end time that already elapsed), the sleep
 * is skipped and the close runs straight away.
 */
export async function examAutoCloseWorkflow(input: ExamAutoCloseInput): Promise<void> {
  const delayMs = computeAutoCloseDelayMs(input.endsAt);
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  await closeActiveSessionsForExam(input.examId);
}
