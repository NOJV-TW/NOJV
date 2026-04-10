import { proxyActivities, sleep } from "@temporalio/workflow";
import type { AssessmentLifecycleInput } from "../types";
import type * as assessmentActivities from "../activities/assessment";
import type * as notificationActivities from "../activities/notification";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";

const assessment = proxyActivities<typeof assessmentActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof notificationActivities>(NOTIFICATION_ACTIVITY);

const DEADLINE_REMINDER_HOURS = 24;

export async function assessmentLifecycleWorkflow(
  input: AssessmentLifecycleInput
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
    const msUntilClose = new Date(info.closesAt).getTime() - Date.now();
    if (msUntilClose > 0) {
      await sleep(msUntilClose);
    }
    await assessment.closeAssessment(input.assessmentId);
  }
}
