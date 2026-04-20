import type { ActivityOptions } from "@temporalio/workflow";

/**
 * Standard options for short-running activities (DB writes, lookups).
 * Used for judge, stats, contest, assessment, and similar quick calls.
 */
export const SHORT_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 },
};

/**
 * Standard options for fire-and-forget notification activities (Redis pub/sub).
 * Shorter timeout and fewer retries since they're best-effort.
 */
export const NOTIFICATION_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 },
};

// Dolos AST analysis across all (problem, language) groups.
export const PLAGIARISM_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: "10m",
  retry: { maximumAttempts: 3 },
};
