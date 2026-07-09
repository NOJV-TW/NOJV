import { proxyActivities, sleep } from "@temporalio/workflow";
import type { AssignmentDueSoonInput } from "@nojv/core";
import type * as lifecycleActivities from "../activities/lifecycle";
import { SHORT_ACTIVITY } from "./activity-options";
import { computeReminderCheckpoints } from "./reminder-checkpoints";

const lifecycle = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

export async function assignmentDueSoonWorkflow(input: AssignmentDueSoonInput): Promise<void> {
  const opensAtMs = Date.parse(input.opensAt);
  const closesAtMs = Date.parse(input.closesAt);

  if (closesAtMs > Date.now()) {
    if (opensAtMs > Date.now()) {
      await sleep(opensAtMs - Date.now());
    }
    await lifecycle.fanoutAssignmentStarted(input.assignmentId);
  }

  for (const cp of computeReminderCheckpoints(closesAtMs, opensAtMs, Date.now())) {
    const ms = cp.atMs - Date.now();
    if (ms > 0) await sleep(ms);
    await lifecycle.fanoutAssignmentDueSoon(input.assignmentId, cp.leadDays);
  }
}
