import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { executeEphemeralWorkspaceRun } from "../src/services/ephemeral-workspace";

const noop = () => undefined;

function createMockSandboxProcess(stdout = "", exitCode = 0) {
  return {
    kill() {
      return true;
    },
    on(
      event: "close" | "error",
      handler: ((code: number | null) => void) | ((error: Error) => void)
    ) {
      if (event === "close") {
        setTimeout(() => {
          (handler as (code: number | null) => void)(exitCode);
        }, 0);
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
        if (event === "data" && stdout) {
          setTimeout(() => handler(stdout), 0);
        }
      },
      setEncoding: noop
    }
  };
}

describe("executeEphemeralWorkspaceRun", () => {
  it("materializes files into an isolated directory before entering the Docker sandbox", async () => {
    let mountedWorkspaceSnapshot: Promise<{ makefile: string; message: string }> | undefined;

    const result = await executeEphemeralWorkspaceRun(
      {
        command: "make run",
        files: [
          {
            content: "run:\n\t@cat src/message.txt\n",
            path: "Makefile"
          },
          {
            content: "hello from isolated workspace\n",
            path: "src/message.txt"
          }
        ],
        mode: "assignment",
        timeoutMs: 3_000,
        workspaceSessionId: "ws_assignment_demo_01"
      },
      {
        sandboxImage: "nojv-sandbox:local",
        spawnImplementation: (_binary, args) => {
          const mountIndex = args.indexOf("--volume");
          const volumeSpec = args[mountIndex + 1];
          if (!volumeSpec) {
            throw new Error("Docker volume mount is missing.");
          }

          const workspaceRoot = volumeSpec.replace(":/workspace", "");
          mountedWorkspaceSnapshot = Promise.all([
            readFile(`${workspaceRoot}/Makefile`, "utf8"),
            readFile(`${workspaceRoot}/src/message.txt`, "utf8")
          ]).then(([makefile, message]) => ({ makefile, message }));

          return createMockSandboxProcess("hello from isolated workspace\n") as never;
        }
      }
    );

    expect(result.status).toBe("succeeded");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello from isolated workspace");
    expect(result.stderr).toBe("");
    expect(mountedWorkspaceSnapshot).toBeDefined();
    await expect(mountedWorkspaceSnapshot).resolves.toEqual({
      makefile: "run:\n\t@cat src/message.txt\n",
      message: "hello from isolated workspace\n"
    });
  });

  it("runs the makefile through a Docker sandbox instead of spawning the binary directly on the host", async () => {
    const spawnCalls: { args: string[]; binary: string }[] = [];
    const result = await executeEphemeralWorkspaceRun(
      {
        command: "make run",
        files: [
          {
            content: "run:\n\t@cat src/message.txt\n",
            path: "Makefile"
          },
          {
            content: "hello from dockerized workspace\n",
            path: "src/message.txt"
          }
        ],
        mode: "assignment",
        timeoutMs: 3_000,
        workspaceSessionId: "ws_assignment_demo_02"
      },
      {
        sandboxImage: "nojv-sandbox:local",
        spawnImplementation: (binary, args) => {
          spawnCalls.push({ args, binary });

          return createMockSandboxProcess("hello from dockerized workspace\n") as never;
        }
      }
    );

    expect(result.status).toBe("succeeded");
    expect(spawnCalls[0]?.binary).toBe("docker");
    expect(spawnCalls[0]?.args).toEqual(
      expect.arrayContaining([
        "run",
        "--rm",
        "--network",
        "none",
        "nojv-sandbox:local",
        "make",
        "run"
      ])
    );
  });

  it("blocks contest commands that fall outside the shell policy allowlist", async () => {
    const result = await executeEphemeralWorkspaceRun({
      command: "bash scripts/cheat.sh",
      contestSlug: "spring-qualifier-2026",
      files: [
        {
          content: "echo cheat\n",
          path: "scripts/cheat.sh"
        }
      ],
      mode: "contest",
      timeoutMs: 3_000,
      workspaceSessionId: "ws_contest_demo_01"
    });

    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("Command policy rejected");
  });
});
