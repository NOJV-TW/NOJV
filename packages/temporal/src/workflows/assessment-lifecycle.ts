import { proxyActivities, sleep } from "@temporalio/workflow";
import type { AssessmentLifecycleInput } from "../types";
import type * as lifecycleActivities from "../activities/lifecycle";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";

const assessment = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof lifecycleActivities>(NOTIFICATION_ACTIVITY);
// `fanoutAssignmentDueSoon` persists notification rows + chunked Redis pub/sub;
// give it SHORT's 30s budget and 3 retries instead of the 10s pub/sub default.
const notificationDurable = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

const DEADLINE_REMINDER_HOURS = 24;

export async function assessmentLifecycleWorkflow(
  input: AssessmentLifecycleInput,
): Promise<void> {
  const info = await assessment.getAssessmentInfo(input.assessmentId);

  const msUntilOpen = new Date(info.opensAt).getTime() - Date.now();
  if (msUntilOpen > 0) {
    await sleep(msUntilOpen);
  }
  await assessment.activateAssessment(input.assessmentId);

  if (info.dueAt) {
    const reminderTime = new Date(info.dueAt).getTime() - DEADLINE_REMINDER_HOURS * 3600_000;
    const msUntilReminder = reminderTime - Date.now();
    if (msUntilReminder > 0) {
      await sleep(msUntilReminder);
    }
    await notification.publishAssessmentDeadline(input.assessmentId);
  }

  if (info.closesAt) {
    // Fan out `assignment_due_soon` notifications 24h before hard close.
    // The domain helper is a no-op if the assessment already closed, so
    // we don't need a second guard here.
    const reminderTime = new Date(info.closesAt).getTime() - DEADLINE_REMINDER_HOURS * 3600_000;
    const msUntilReminder = reminderTime - Date.now();
    if (msUntilReminder > 0) {
      await sleep(msUntilReminder);
    }
    await notificationDurable.fanoutAssignmentDueSoon(input.assessmentId);

    const msUntilClose = new Date(info.closesAt).getTime() - Date.now();
    if (msUntilClose > 0) {
      await sleep(msUntilClose);
    }
    await assessment.closeAssessment(input.assessmentId);
  }
}
