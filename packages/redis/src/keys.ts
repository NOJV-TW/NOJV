// Centralized Redis key registry.
// Data keys use the `nojv:` prefix.
// Pub/sub channels do NOT use the prefix (to avoid breaking SSE subscribers).

export const keys = {
  // --- Data keys ---
  cooldown: (userId: string, problemId: string) => `nojv:cooldown:${userId}:${problemId}`,
  scoreboard: (contestId: string) => `nojv:scoreboard:${contestId}`,
  scoreboardFrozen: (contestId: string) => `nojv:scoreboard:${contestId}:frozen`,
  cache: (key: string) => `nojv:cache:${key}`,

  // --- Pub/sub channels (no prefix) ---
  userChannel: (userId: string) => `user:${userId}`,
  contestChannel: (contestId: string) => `contest:${contestId}`,
  assessmentChannel: (assessmentId: string) => `assessment:${assessmentId}`
} as const;
