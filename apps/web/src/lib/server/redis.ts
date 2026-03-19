import Redis from "ioredis";
import { parseRedisConnection } from "@nojv/core";

export function createSubscriber(redisUrl: string): Redis {
  const opts = parseRedisConnection(redisUrl);
  return new Redis({ host: opts.host, port: opts.port, password: opts.password });
}
