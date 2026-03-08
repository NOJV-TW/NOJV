import { describe, expect, it, vi } from "vitest";

import {
  buildDockerSandboxInvocation,
  runDockerSandboxCommand
} from "../src/services/docker-sandbox";

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

describe("buildDockerSandboxInvocation", () => {
  it("builds a hardened docker run command with network, cpu, memory, and mount limits", () => {
    const invocation = buildDockerSandboxInvocation({
      argv: ["make", "run"],
      containerName: "nojv-sandbox-ws-01",
      cpuLimit: "1.5",
      image: "nojv-sandbox:local",
      memoryMb: 384,
      pidsLimit: 96,
      workspaceRoot: "/tmp/nojv-ws-01"
    });

    expect(invocation.binary).toBe("docker");
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "run",
        "--rm",
        "--name",
        "nojv-sandbox-ws-01",
        "--network",
        "none",
        "--cpus",
        "1.5",
        "--memory",
        "384m",
        "--pids-limit",
        "96",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=64m",
        "--workdir",
        "/workspace",
        "--volume",
        "/tmp/nojv-ws-01:/workspace",
        "--env",
        "HOME=/tmp",
        "nojv-sandbox:local",
        "make",
        "run"
      ])
    );
  });
});

describe("runDockerSandboxCommand", () => {
  it("maps container stdout and stderr into the existing workspace result contract", async () => {
    const result = await runDockerSandboxCommand(
      {
        argv: ["make", "run"],
        containerName: "nojv-sandbox-ws-02",
        cpuLimit: "1",
        image: "nojv-sandbox:local",
        memoryMb: 256,
        pidsLimit: 64,
        stdin: "2 5\n",
        timeoutMs: 3_000,
        workspaceRoot: "/tmp/nojv-ws-02"
      },
      {
        spawnImplementation: vi.fn(() =>
          createMockSandboxProcess("hello from docker sandbox\n")
        )
      }
    );

    expect(result.status).toBe("succeeded");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello from docker sandbox");
    expect(result.stderr).toBe("");
  });
});
