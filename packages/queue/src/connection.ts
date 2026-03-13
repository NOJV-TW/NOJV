interface RedisConnectionOptions {
  host: string;
  maxRetriesPerRequest: null;
  password: string | undefined;
  port: number;
}

export function parseRedisConnection(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    maxRetriesPerRequest: null,
    password: url.password || undefined,
    port: Number(url.port || "6379")
  };
}
