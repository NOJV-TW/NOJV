export const keys = {
  scoreboard: (contestId: string) => `nojv:scoreboard:${contestId}`,
  scoreboardFrozen: (contestId: string) => `nojv:scoreboard:${contestId}:frozen`,

  adminDashboard: () => "nojv:cache:admin-dashboard",

  userChannel: (userId: string) => `user:${userId}`,
  notificationChannel: (userId: string) => `notification:${userId}`,
  contestChannel: (contestId: string) => `contest:${contestId}`,
  assessmentChannel: (assessmentId: string) => `assessment:${assessmentId}`,
  clarificationChannel: (contextType: string, contextId: string) =>
    `clarification:${contextType}:${contextId}`,
} as const;
