import type { ActivityOptions } from "@temporalio/workflow";

export const PLATFORM_QUEUE = "platform" as const;

export const SHORT_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 },
};

export const NOTIFICATION_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 },
};

export const PLAGIARISM_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: "10m",
  retry: { maximumAttempts: 3 },
};

export const REGISTRY_GC_ACTIVITY: ActivityOptions = {
  startToCloseTimeout: "30m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 2 },
};
