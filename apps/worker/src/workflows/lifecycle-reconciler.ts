import { continueAsNew, proxyActivities } from "@temporalio/workflow";

import type { LifecycleReconcileCursor, LifecycleReconcileResult } from "@nojv/application";
import type * as lifecycleActivities from "../activities/lifecycle";
import { SHORT_ACTIVITY } from "./activity-options";

const lifecycle = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

type Reconcile = (input: LifecycleReconcileCursor) => Promise<LifecycleReconcileResult>;
type ContinueReconciliation = (input: LifecycleReconcileCursor) => Promise<void>;

export async function drainLifecycleReconciliation(
  reconcile: Reconcile,
  continueRun: ContinueReconciliation,
  input: LifecycleReconcileCursor = {},
): Promise<void> {
  const result = await reconcile(input);
  if (result.next) await continueRun(result.next);
}

export function lifecycleReconcilerWorkflow(
  input: LifecycleReconcileCursor = {},
): Promise<void> {
  return drainLifecycleReconciliation(
    lifecycle.reconcileLifecycleWorkflows,
    (nextInput) => continueAsNew<typeof lifecycleReconcilerWorkflow>(nextInput),
    input,
  );
}
