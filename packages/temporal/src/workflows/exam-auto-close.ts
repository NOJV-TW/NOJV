import { proxyActivities, sleep } from "@temporalio/workflow";
import type { ExamAutoCloseInput } from "../types";
import type * as examSessionActivities from "../activities/exam-session";
import { SHORT_ACTIVITY } from "./activity-options";
import { computeAutoCloseDelayMs } from "./exam-auto-close-helpers";

const { closeActiveSessionsForExam } =
  proxyActivities<typeof examSessionActivities>(SHORT_ACTIVITY);

export async function examAutoCloseWorkflow(input: ExamAutoCloseInput): Promise<void> {
  const delayMs = computeAutoCloseDelayMs(input.endsAt);
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  await closeActiveSessionsForExam(input.examId);
}
