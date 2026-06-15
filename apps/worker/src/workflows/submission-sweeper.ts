import { proxyActivities } from "@temporalio/workflow";

import type * as lifecycleActivities from "../activities/lifecycle";
import { SHORT_ACTIVITY } from "./activity-options";

const lifecycle = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

export async function submissionSweeperWorkflow(): Promise<void> {
  await lifecycle.sweepStaleSubmissions();
}
