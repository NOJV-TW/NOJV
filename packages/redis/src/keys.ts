// Data keys use the `nojv:` prefix; pub/sub channels deliberately do NOT
// use the prefix, because SSE subscribers subscribe to the unprefixed
// channel name and changing that would break existing connections.

export const keys = {
  scoreboard: (contestId: string) => `nojv:scoreboard:${contestId}`,
  scoreboardFrozen: (contestId: string) => `nojv:scoreboard:${contestId}:frozen`,

  userChannel: (userId: string) => `user:${userId}`,
  notificationChannel: (userId: string) => `notification:${userId}`,
  contestChannel: (contestId: string) => `contest:${contestId}`,
  assessmentChannel: (assessmentId: string) => `assessment:${assessmentId}`,
  clarificationChannel: (contextType: string, contextId: string) =>
    `clarification:${contextType}:${contextId}`,
} as const;
