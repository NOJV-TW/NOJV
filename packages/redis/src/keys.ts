// Data keys use the `nojv:` prefix; pub/sub channels deliberately do NOT
// use the prefix, because SSE subscribers subscribe to the unprefixed
// channel name and changing that would break existing connections.

export const keys = {
  cooldown: (userId: string, problemId: string) => `nojv:cooldown:${userId}:${problemId}`,
  scoreboard: (contestId: string) => `nojv:scoreboard:${contestId}`,
  scoreboardFrozen: (contestId: string) => `nojv:scoreboard:${contestId}:frozen`,
  cache: (key: string) => `nojv:cache:${key}`,

  userChannel: (userId: string) => `user:${userId}`,
  contestChannel: (contestId: string) => `contest:${contestId}`,
  assessmentChannel: (assessmentId: string) => `assessment:${assessmentId}`
} as const;
