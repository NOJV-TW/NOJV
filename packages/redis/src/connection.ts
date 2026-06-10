import Redis from "ioredis";
import { parseRedisConnection } from "@nojv/core";

let _redis: Redis | undefined;

function withErrorHandler(client: Redis): Redis {
  client.on("error", (err: unknown) => {
    console.error(
      "[redis] connection error:",
      err instanceof Error ? err.message : String(err),
    );
  });
  return client;
}

export function getRedis(): Redis {
  if (!_redis) {
    const opts = parseRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6379");
    _redis = withErrorHandler(
      new Redis({ host: opts.host, port: opts.port, password: opts.password }),
    );
  }
  return _redis;
}

export function createSubscriber(redisUrl: string): Redis {
  const opts = parseRedisConnection(redisUrl);
  return withErrorHandler(
    new Redis({ host: opts.host, port: opts.port, password: opts.password }),
  );
}
