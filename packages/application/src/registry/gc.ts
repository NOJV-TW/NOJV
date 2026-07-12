import type { PlatformRole, RegistryGarbageCollectInput } from "@nojv/core";

import { ForbiddenError } from "../shared/errors";
import { getDomainOrchestration } from "../shared/orchestration";

export interface RegistryGcActor {
  userId: string;
  platformRole: PlatformRole;
}

export async function triggerRegistryGarbageCollect(
  actor: RegistryGcActor,
): Promise<{ workflowId: string; alreadyRunning: boolean }> {
  if (actor.platformRole !== "admin") {
    throw new ForbiddenError("Only administrators can run registry garbage collection.");
  }
  const input: RegistryGarbageCollectInput = { triggeredByUserId: actor.userId };
  return getDomainOrchestration().dispatchRegistryGarbageCollect(input);
}
