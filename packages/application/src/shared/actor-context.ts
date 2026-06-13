import type { PlatformRole } from "@nojv/core";

export interface ActorContext {
  displayName: string;
  email: string;
  username: string;
  platformRole: PlatformRole;
  userId: string;
}
