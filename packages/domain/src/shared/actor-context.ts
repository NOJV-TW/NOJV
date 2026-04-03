import type { PlatformRole } from "@nojv/core";

/**
 * Domain-level actor context — no SvelteKit dependency.
 * Used across submission, contest, and course mutations.
 */
export interface ActorContext {
  displayName: string;
  email: string;
  username: string;
  platformRole: PlatformRole;
  userId: string;
}
