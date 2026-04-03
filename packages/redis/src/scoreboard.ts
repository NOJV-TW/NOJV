import { getRedis } from "./connection";
import { keys } from "./keys";

export async function updateScoreboard(
  contestId: string,
  participationId: string,
  score: number
): Promise<void> {
  const key = keys.scoreboard(contestId);
  await getRedis().zadd(key, score.toString(), participationId);
}

export async function getScoreboard(
  contestId: string,
  start = 0,
  stop = -1
): Promise<{ participationId: string; score: number }[]> {
  const key = keys.scoreboard(contestId);
  const results = await getRedis().zrevrange(key, start, stop, "WITHSCORES");
  const entries: { participationId: string; score: number }[] = [];
  for (let i = 0; i + 1 < results.length; i += 2) {
    const participationId = results[i];
    const scoreStr = results[i + 1];
    if (participationId != null && scoreStr != null) {
      entries.push({ participationId, score: Number(scoreStr) });
    }
  }
  return entries;
}

export async function freezeScoreboard(contestId: string): Promise<void> {
  const key = keys.scoreboard(contestId);
  const frozenKey = keys.scoreboardFrozen(contestId);
  await getRedis().rename(key, frozenKey);
}

export async function unfreezeScoreboard(contestId: string): Promise<void> {
  const frozenKey = keys.scoreboardFrozen(contestId);
  const exists = await getRedis().exists(frozenKey);
  if (exists) {
    await getRedis().rename(frozenKey, keys.scoreboard(contestId));
  }
}
