import { proxyActivities, sleep } from "@temporalio/workflow";
import type { AssignmentDueSoonInput } from "@nojv/temporal";
import type * as lifecycleActivities from "../activities/lifecycle";
import { SHORT_ACTIVITY } from "./activity-options";

const lifecycle = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

const DUE_SOON_LEAD_MINUTES = 24 * 60;

export async function assignmentDueSoonWorkflow(input: AssignmentDueSoonInput): Promise<void> {
  const reminderAtMs = new Date(input.closesAt).getTime() - DUE_SOON_LEAD_MINUTES * 60_000;
  const msUntilReminder = reminderAtMs - Date.now();
  if (msUntilReminder > 0) {
    await sleep(msUntilReminder);
  }
  await lifecycle.fanoutAssignmentDueSoon(input.assignmentId);
}
