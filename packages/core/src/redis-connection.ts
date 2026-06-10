interface RedisConnectionOptions {
  host: string;
  password: string | undefined;
  port: number;
}

export function parseRedisConnection(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:") {
    throw new Error(
      `parseRedisConnection: unsupported protocol "${url.protocol}" — only redis:// is wired up (no TLS / rediss support)`,
    );
  }
  if (url.pathname !== "" && url.pathname !== "/" && url.pathname !== "/0") {
    throw new Error(
      `parseRedisConnection: DB index "${url.pathname}" is not supported — connections always use DB 0`,
    );
  }
  return {
    host: url.hostname,
    password: url.password || undefined,
    port: Number(url.port || "6379"),
  };
}
