import { proxyActivities, sleep } from "@temporalio/workflow";
import type { ExamAutoCloseInput } from "../types";
import type * as examSessionActivities from "../activities/exam-session";
import type * as notificationActivities from "../activities/notification";
import { SHORT_ACTIVITY } from "./activity-options";
import { computeAutoCloseDelayMs } from "./exam-auto-close-helpers";

const { closeActiveSessionsForExam } =
  proxyActivities<typeof examSessionActivities>(SHORT_ACTIVITY);
// `fanoutExamStartingSoon` persists notification rows + chunked Redis
// pub/sub; use SHORT's 30s budget and 3 retries.
const notification = proxyActivities<typeof notificationActivities>(SHORT_ACTIVITY);

const START_REMINDER_MINUTES = 15;

export async function examAutoCloseWorkflow(input: ExamAutoCloseInput): Promise<void> {
  // Fan out `exam_starting_soon` 15 min before the exam opens. The
  // domain helper no-ops if the exam was unpublished or the start time
  // already passed — no second guard required here.
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
