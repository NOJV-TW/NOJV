import { beforeEach, describe, expect, it, vi } from "vitest";

const markSubmissionRunning = vi.fn();
const completeSubmission = vi.fn();
const markWorkspaceRunRunning = vi.fn();
const completeWorkspaceRun = vi.fn();
const getSubmissionJudgeContext = vi.fn();
const executeEphemeralWorkspaceRun = vi.fn();

vi.mock("@nojv/db", () => {
  return {
    completeSubmission,
    completeWorkspaceRun,
    getSubmissionJudgeContext,
    markSubmissionRunning,
    markWorkspaceRunRunning
  };
});

vi.mock("../src/services/ephemeral-workspace", () => ({
  executeEphemeralWorkspaceRun
}));

describe("async processor persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks queued submissions running and completes them against the same record", async () => {
    getSubmissionJudgeContext.mockResolvedValue({
      memoryLimitMb: 256,
      problemSlug: "warmup-sum",
      testcases: [
        {
          expectedStdout: "3\n",
          id: "tc_async_01",
          isHidden: false,
          stdin: "1 2\n",
          weight: 1
        }
      ],
      timeLimitMs: 1_000
    });
    executeEphemeralWorkspaceRun.mockResolvedValue({
      durationMs: 14,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "3\n"
    });
    const { processSubmission } = await import("../src/processors");

    await processSubmission({
      data: {
        draft: {
          language: "cpp",
          mode: "practice",
          problemSlug: "warmup-sum",
          sourceCode:
            "#include <iostream>\nint main() { int a, b; std::cin >> a >> b; std::cout << a + b; }\n"
        },
        submissionId: "sub_test_async_01"
      }
    } as never);

    expect(markSubmissionRunning).toHaveBeenCalledWith("sub_test_async_01");
    expect(getSubmissionJudgeContext).toHaveBeenCalledWith("sub_test_async_01");
    expect(completeSubmission).toHaveBeenCalledWith(
      "sub_test_async_01",
      expect.objectContaining({
        verdict: "accepted"
      })
    );
  });

  it("marks queued workspace runs running and completes them against the same record", async () => {
    executeEphemeralWorkspaceRun.mockResolvedValue({
      durationMs: 24,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "hello from async processor\n"
    });
    const { processWorkspaceRun } = await import("../src/processors");

    await processWorkspaceRun({
      data: {
        request: {
          command: "make run",
          files: [
            {
              content: "run:\n\t@cat src/message.txt\n",
              path: "Makefile"
            },
            {
              content: "hello from async processor\n",
              path: "src/message.txt"
            }
          ],
          mode: "assignment",
          timeoutMs: 3_000,
          workspaceSessionId: "ws_async_processor_01"
        },
        workspaceRunId: "run_test_async_01"
      }
    } as never);

    expect(markWorkspaceRunRunning).toHaveBeenCalledWith("run_test_async_01");
    expect(completeWorkspaceRun).toHaveBeenCalledWith(
      "run_test_async_01",
      expect.objectContaining({
        status: "succeeded"
      })
    );
  });
});
