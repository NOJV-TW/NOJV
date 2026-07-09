import { proxyActivities, sleep } from "@temporalio/workflow";
import type { ExamAutoCloseInput } from "@nojv/core";
import type * as lifecycleActivities from "../activities/lifecycle";
import { SHORT_ACTIVITY } from "./activity-options";
import { computeAutoCloseDelayMs } from "./exam-auto-close-helpers";
import { computeReminderCheckpoints } from "./reminder-checkpoints";

const { closeActiveSessionsForExam } =
  proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

export async function examAutoCloseWorkflow(input: ExamAutoCloseInput): Promise<void> {
  const startsAtMs = Date.parse(input.startsAt);
  for (const cp of computeReminderCheckpoints(startsAtMs, 0, Date.now())) {
    const ms = cp.atMs - Date.now();
    if (ms > 0) await sleep(ms);
    await notification.fanoutExamStartingSoon(input.examId, cp.leadDays);
  }

  const delayMs = computeAutoCloseDelayMs(input.endsAt);
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  await closeActiveSessionsForExam(input.examId);
}
