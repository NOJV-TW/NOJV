export const keys = {
  adminDashboard: () => "nojv:cache:admin-dashboard",

  scoreboardUpdateThrottle: (contestId: string) => `nojv:sb-throttle:${contestId}`,

  userChannel: (userId: string) => `nojv:user:${userId}`,
  notificationChannel: (userId: string) => `nojv:notification:${userId}`,
  contestChannel: (contestId: string) => `nojv:contest:${contestId}`,
  clarificationChannel: (contextType: string, contextId: string) =>
    `nojv:clarification:${contextType}:${contextId}`,
} as const;
