import { getRedis } from "./connection";
import { keys } from "./keys";

// Value is irrelevant; only the key's existence + TTL matter.
const COOLDOWN_FLAG = "1";

export async function setCooldown(
  userId: string,
  problemId: string,
  seconds: number,
): Promise<boolean> {
  const key = keys.cooldown(userId, problemId);
  const result = await getRedis().set(key, COOLDOWN_FLAG, "EX", seconds, "NX");
  return result === "OK";
}

export async function checkCooldown(userId: string, problemId: string): Promise<boolean> {
  const key = keys.cooldown(userId, problemId);
  return (await getRedis().exists(key)) === 1;
}
