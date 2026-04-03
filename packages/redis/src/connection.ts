import Redis from "ioredis";
import { parseRedisConnection } from "@nojv/core";

let _redis: Redis | undefined;

export function getRedis(): Redis {
  if (!_redis) {
    const opts = parseRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6379");
    _redis = new Redis({ host: opts.host, port: opts.port, password: opts.password });
  }
  return _redis;
}

export function createSubscriber(redisUrl: string): Redis {
  const opts = parseRedisConnection(redisUrl);
  return new Redis({ host: opts.host, port: opts.port, password: opts.password });
}
