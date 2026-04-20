import { getRedis } from "./connection";
import { keys } from "./keys";

export async function setCooldown(
  userId: string,
  problemId: string,
  seconds: number,
): Promise<boolean> {
  const key = keys.cooldown(userId, problemId);
  const result = await getRedis().set(key, "1", "EX", seconds, "NX");
  return result === "OK";
}

export async function checkCooldown(userId: string, problemId: string): Promise<boolean> {
  const key = keys.cooldown(userId, problemId);
  return (await getRedis().exists(key)) === 1;
}
