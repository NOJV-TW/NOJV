import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSandboxServer } from "../src/index";

describe("createSandboxServer", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects requests without the shared bearer token", async () => {
    const server = createSandboxServer(
      {
        SANDBOX_SHARED_TOKEN: "sandbox-secret"
      },
      {
        executeRun: vi.fn()
      }
    );

    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Sandbox test server did not bind to a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/execute`, {
      body: JSON.stringify({
        command: "make run",
        files: [
          {
            content: "run:\n\t@echo ok\n",
            path: "Makefile"
          }
        ],
        mode: "assignment",
        timeoutMs: 3_000,
        workspaceSessionId: "ws_sandbox_server_01"
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });

    expect(response.status).toBe(401);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });
});
