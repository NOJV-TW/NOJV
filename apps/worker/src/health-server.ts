import { createServer, type Server, type ServerResponse } from "node:http";
import { runTransaction } from "@nojv/db";
import Redis from "ioredis";

const CHECK_TIMEOUT_MS = 3000;

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function checkPostgres(): Promise<string> {
  try {
    await withTimeout(
      runTransaction((tx) => tx.$queryRawUnsafe("SELECT 1")),
      CHECK_TIMEOUT_MS,
    );
    return "ok";
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function checkRedis(redisUrl: string): Promise<string> {
  let client: Redis | undefined;
  try {
    client = new Redis(redisUrl, { lazyConnect: true, connectTimeout: CHECK_TIMEOUT_MS });
    await withTimeout(client.connect(), CHECK_TIMEOUT_MS);
    await withTimeout(client.ping(), CHECK_TIMEOUT_MS);
    return "ok";
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    await client?.quit().catch(() => undefined);
  }
}

export interface HealthDeps {
  redisUrl: string;
  checkTemporal: () => Promise<boolean>;
}

async function probeTemporal(deps: HealthDeps): Promise<boolean> {
  try {
    return await withTimeout(deps.checkTemporal(), CHECK_TIMEOUT_MS);
  } catch {
    return false;
  }
}

async function handleHealthz(deps: HealthDeps, response: ServerResponse): Promise<void> {
  const [postgres, redis, temporalOk] = await Promise.all([
    checkPostgres(),
    checkRedis(deps.redisUrl),
    probeTemporal(deps),
  ]);

  const temporal = temporalOk ? "ok" : "error: not connected";
  const checks = { postgres, redis, temporal };
  const healthy = postgres === "ok" && redis === "ok" && temporalOk;

  writeJson(response, healthy ? 200 : 503, {
    status: healthy ? "healthy" : "unhealthy",
    checks,
  });
}

async function handleReadyz(deps: HealthDeps, response: ServerResponse): Promise<void> {
  const ready = await probeTemporal(deps);
  writeJson(response, ready ? 200 : 503, {
    ready,
    ...(ready ? {} : { reason: "temporal not connected" }),
  });
}

export function createWorkerHealthServer(deps: HealthDeps): Server {
  return createServer((request, response) => {
    if (request.url === "/livez" && request.method === "GET") {
      writeJson(response, 200, { status: "alive" });
      return;
    }

    if (request.url === "/healthz" && request.method === "GET") {
      void handleHealthz(deps, response);
      return;
    }

    if (request.url === "/readyz" && request.method === "GET") {
      void handleReadyz(deps, response);
      return;
    }

    writeJson(response, 404, { message: "Not found." });
  });
}
