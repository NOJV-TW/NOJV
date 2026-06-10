import { afterEach, describe, expect, it } from "vitest";

import { createWorkerHealthServer } from "../../../apps/worker/src/health-server";
import { closeServerSafely } from "../../../apps/worker/src/server-lifecycle";

const mockDeps = {
  redisUrl: "redis://localhost:6379",
  checkTemporal: () => Promise.resolve(true),
};

const servers: { close: () => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("worker health server", () => {
  it("responds on /healthz for production probes", async () => {
    const server = createWorkerHealthServer(mockDeps);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        servers.push(server);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP server address.");
    }

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/readyz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ready: true });
  });

  it("reports not-ready on /readyz when Temporal is unreachable", async () => {
    const server = createWorkerHealthServer({
      redisUrl: "redis://localhost:6379",
      checkTemporal: () => Promise.resolve(false),
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        servers.push(server);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP server address.");
    }

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/readyz`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ready: false });
  });

  it("reports not-ready on /readyz when the Temporal probe rejects", async () => {
    const server = createWorkerHealthServer({
      redisUrl: "redis://localhost:6379",
      checkTemporal: () => Promise.reject(new Error("connection refused")),
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        servers.push(server);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP server address.");
    }

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/readyz`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ready: false });
  });

  it("allows repeated shutdown without server-not-running errors", async () => {
    const server = createWorkerHealthServer(mockDeps);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    await expect(closeServerSafely(server)).resolves.toBeUndefined();
    await expect(closeServerSafely(server)).resolves.toBeUndefined();
  });
});
