import type { ActivityOptions } from "@temporalio/workflow";

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
