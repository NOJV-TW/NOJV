import { proxyActivities, sleep } from "@temporalio/workflow";
import type { ExamAutoCloseInput } from "@nojv/core";
import type * as lifecycleActivities from "../activities/lifecycle";
import { SHORT_ACTIVITY } from "./activity-options";
import { computeAutoCloseDelayMs } from "./exam-auto-close-helpers";

const { closeActiveSessionsForExam } =
  proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

const START_REMINDER_MINUTES = 15;

export async function examAutoCloseWorkflow(input: ExamAutoCloseInput): Promise<void> {
  const reminderAtMs = new Date(input.startsAt).getTime() - START_REMINDER_MINUTES * 60_000;
  const msUntilReminder = reminderAtMs - Date.now();
  if (msUntilReminder > 0) {
    await sleep(msUntilReminder);
  }
  await notification.fanoutExamStartingSoon(input.examId);

  const delayMs = computeAutoCloseDelayMs(input.endsAt);
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  await closeActiveSessionsForExam(input.examId);
}
