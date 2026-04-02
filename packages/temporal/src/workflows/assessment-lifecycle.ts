import { proxyActivities, sleep } from "@temporalio/workflow";
import type { AssessmentLifecycleInput } from "../types";
import type * as assessmentActivities from "../activities/assessment";
import type * as notificationActivities from "../activities/notification";

const assessment = proxyActivities<typeof assessmentActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 }
});

const notification = proxyActivities<typeof notificationActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 }
});

const DEADLINE_REMINDER_HOURS = 24;

export async function assessmentLifecycleWorkflow(input: AssessmentLifecycleInput): Promise<void> {
  const info = await assessment.getAssessmentInfo(input.assessmentId);

  // 1. Wait until opens
  const msUntilOpen = new Date(info.opensAt).getTime() - Date.now();
  if (msUntilOpen > 0) {
    await sleep(msUntilOpen);
  }
  await assessment.activateAssessment(input.assessmentId);

  // 2. Wait until reminder time (dueAt - N hours)
  if (info.dueAt) {
    const reminderTime = new Date(info.dueAt).getTime() - DEADLINE_REMINDER_HOURS * 3600_000;
    const msUntilReminder = reminderTime - Date.now();
    if (msUntilReminder > 0) {
      await sleep(msUntilReminder);
    }
    await notification.publishAssessmentDeadline(input.assessmentId);
  }

  // 3. Wait until closes
  if (info.closesAt) {
    const msUntilClose = new Date(info.closesAt).getTime() - Date.now();
    if (msUntilClose > 0) {
      await sleep(msUntilClose);
    }
    await assessment.closeAssessment(input.assessmentId);
  }
}
