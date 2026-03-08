import { describe, expect, it, vi } from "vitest";

import { executeHostedWorkspaceRun } from "../src/services/host-executor";

const noop = () => undefined;

describe("executeHostedWorkspaceRun", () => {
  it("maps hosted execution output into the shared workspace result contract", async () => {
    const result = await executeHostedWorkspaceRun(
      {
        command: "make run",
        files: [
          {
            content: "run:\n\t@cat src/message.txt\n",
            path: "Makefile"
          },
          {
            content: "hello from hosted sandbox\n",
            path: "src/message.txt"
          }
        ],
        mode: "assignment",
        timeoutMs: 3_000,
        workspaceSessionId: "ws_hosted_executor_01"
      },
      {
        spawnImplementation: vi.fn(() => ({
          kill() {
            return true;
          },
          on(event: string, handler: (value: number | Error | null) => void) {
            if (event === "close") {
              setTimeout(() => handler(0), 0);
            }
          },
          stderr: {
            on: noop,
            setEncoding: noop
          },
          stdin: {
            end: noop,
            write: noop
          },
          stdout: {
            on(event: string, handler: (value: string) => void) {
              if (event === "data") {
                setTimeout(() => handler("hello from hosted sandbox\n"), 0);
              }
            },
            setEncoding: noop
          }
        }))
      }
    );

    expect(result.status).toBe("succeeded");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello from hosted sandbox");
  });
});
