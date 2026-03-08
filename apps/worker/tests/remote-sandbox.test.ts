import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runRemoteSandboxCommand } from "../src/services/remote-sandbox";

describe("runRemoteSandboxCommand", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts authenticated execution requests to the remote sandbox service", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            durationMs: 18,
            exitCode: 0,
            stderr: "",
            status: "succeeded",
            stdout: "hello from remote sandbox\n"
          }),
          {
            status: 200
          }
        )
      )
    );
    globalThis.fetch = fetchMock;

    await runRemoteSandboxCommand(
      {
        command: "make run",
        files: [
          {
            content: "run:\n\t@echo ok\n",
            path: "Makefile"
          }
        ],
        mode: "assignment",
        timeoutMs: 3_000,
        workspaceSessionId: "ws_remote_sandbox_01"
      },
      {
        baseUrl: "https://sandbox.internal",
        sharedToken: "sandbox-secret"
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];

    if (!firstCall) {
      throw new Error("Expected fetch to be called.");
    }

    expect(firstCall[0]).toBe("https://sandbox.internal/execute");
    expect(firstCall[1]).toMatchObject({
      headers: {
        Authorization: "Bearer sandbox-secret"
      },
      method: "POST"
    });
  });
});
