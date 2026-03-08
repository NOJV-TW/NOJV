import { beforeEach, describe, expect, it, vi } from "vitest";

const completeWorkspaceRun = vi.fn();
const markWorkspaceRunRunning = vi.fn();
const executeEphemeralWorkspaceRun = vi.fn();
const runRemoteSandboxCommand = vi.fn();

vi.mock("@nojv/db", () => {
  return {
    completeSubmission: vi.fn(),
    completeWorkspaceRun,
    markSubmissionRunning: vi.fn(),
    markWorkspaceRunRunning
  };
});

vi.mock("../src/services/ephemeral-workspace", () => ({
  executeEphemeralWorkspaceRun
}));

vi.mock("../src/services/remote-sandbox", () => ({
  runRemoteSandboxCommand
}));

describe("workspace execution backend selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("uses the remote sandbox backend when configured", async () => {
    process.env.EXECUTION_BACKEND = "remote_http";
    process.env.SANDBOX_BASE_URL = "https://sandbox.internal";
    process.env.SANDBOX_SHARED_TOKEN = "sandbox-secret";
    runRemoteSandboxCommand.mockResolvedValue({
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "remote\n"
    });

    const { processWorkspaceRun } = await import("../src/processors");

    await processWorkspaceRun({
      data: {
        request: {
          command: "make run",
          files: [
            {
              content: "run:\n\t@echo ok\n",
              path: "Makefile"
            }
          ],
          mode: "assignment",
          timeoutMs: 3_000,
          workspaceSessionId: "ws_remote_backend_01"
        },
        workspaceRunId: "run_remote_backend_01"
      }
    } as never);

    expect(runRemoteSandboxCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "make run"
      }),
      {
        baseUrl: "https://sandbox.internal",
        sharedToken: "sandbox-secret"
      }
    );
    expect(executeEphemeralWorkspaceRun).not.toHaveBeenCalled();
  });
});
