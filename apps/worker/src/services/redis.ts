import Redis from "ioredis";
import { parseRedisConnection, type SSEEvent } from "@nojv/core";

export function createPublisher(redisUrl: string): Redis {
  const opts = parseRedisConnection(redisUrl);
  return new Redis({ host: opts.host, port: opts.port, password: opts.password });
}

export function publishEvent(
  publisher: Redis,
  channel: string,
  event: SSEEvent
): Promise<number> {
  return publisher.publish(channel, JSON.stringify(event));
}
