export const keys = {
  scoreboard: (contestId: string) => `nojv:scoreboard:${contestId}`,
  scoreboardFrozen: (contestId: string) => `nojv:scoreboard:${contestId}:frozen`,

  adminDashboard: () => "nojv:cache:admin-dashboard",

  userChannel: (userId: string) => `nojv:user:${userId}`,
  notificationChannel: (userId: string) => `nojv:notification:${userId}`,
  contestChannel: (contestId: string) => `nojv:contest:${contestId}`,
  assessmentChannel: (assessmentId: string) => `nojv:assessment:${assessmentId}`,
  clarificationChannel: (contextType: string, contextId: string) =>
    `nojv:clarification:${contextType}:${contextId}`,
} as const;
