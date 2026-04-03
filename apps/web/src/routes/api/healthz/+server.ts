import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { runTransaction } from "@nojv/db";
import { getRedis } from "@nojv/redis";

const CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

async function checkPostgres(): Promise<string> {
  try {
    await withTimeout(
      runTransaction((tx) => tx.$queryRawUnsafe("SELECT 1")),
      CHECK_TIMEOUT_MS
    );
    return "ok";
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function checkRedis(): Promise<string> {
  try {
    const result = await withTimeout(getRedis().ping(), CHECK_TIMEOUT_MS);
    return result === "PONG" ? "ok" : `unexpected: ${result}`;
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const GET: RequestHandler = async () => {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);

  const checks = { postgres, redis };
  const healthy = postgres === "ok" && redis === "ok";

  return json(
    { status: healthy ? "healthy" : "unhealthy", checks },
    { status: healthy ? 200 : 503 }
  );
};
