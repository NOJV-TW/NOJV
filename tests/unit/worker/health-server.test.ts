import { afterEach, describe, expect, it } from "vitest";

import { createWorkerHealthServer } from "../../../apps/worker/src/health-server";
import { closeServerSafely } from "../../../apps/worker/src/server-lifecycle";

const servers: { close: () => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("worker health server", () => {
  it("responds on /healthz for production probes", async () => {
    const server = createWorkerHealthServer();

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

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("allows repeated shutdown without server-not-running errors", async () => {
    const server = createWorkerHealthServer();

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    await expect(closeServerSafely(server)).resolves.toBeUndefined();
    await expect(closeServerSafely(server)).resolves.toBeUndefined();
  });
});
