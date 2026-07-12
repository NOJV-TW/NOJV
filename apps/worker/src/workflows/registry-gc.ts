import { proxyActivities } from "@temporalio/workflow";
import type { RegistryGarbageCollectInput } from "@nojv/core";
import type * as registryActivities from "../activities/registry";
import { REGISTRY_GC_ACTIVITY } from "./activity-options";

const registry = proxyActivities<typeof registryActivities>(REGISTRY_GC_ACTIVITY);

export async function registryGarbageCollectWorkflow(
  input: RegistryGarbageCollectInput,
): Promise<string> {
  return registry.runRegistryGarbageCollect(input);
}
