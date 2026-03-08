import { describe, expect, it, vi } from "vitest";

describe("judgeSubmissionAgainstTestcases", () => {
  it("adds sandbox orchestration budget on top of the problem time limit", async () => {
    const { buildJudgeWorkspaceRequest } = await import("../src/services/submission-runner");

    const request = buildJudgeWorkspaceRequest({
      draft: {
        language: "python",
        mode: "practice",
        problemSlug: "warmup-sum",
        sourceCode: "print(3)\n"
      },
      memoryLimitMb: 256,
      stdin: "1 2\n",
      testcaseId: "tc_timeout_budget",
      timeLimitMs: 1_000,
      workspaceSessionId: "sub-warmup-sum-tc-timeout-budget"
    });

    expect(request.timeoutMs).toBe(5_000);
    expect(request.stdin).toBeUndefined();
    expect(request.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: "1 2\n",
          path: "stdin.txt"
        })
      ])
    );
  });

  it("accepts a Python submission when every testcase matches", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");
    const runSolution = vi
      .fn()
      .mockResolvedValueOnce({
        durationMs: 8,
        exitCode: 0,
        stderr: "",
        status: "succeeded",
        stdout: "3\n"
      })
      .mockResolvedValueOnce({
        durationMs: 7,
        exitCode: 0,
        stderr: "",
        status: "succeeded",
        stdout: "300\n"
      });

    const result = await judgeSubmissionAgainstTestcases(
      {
        draft: {
          language: "python",
          mode: "practice",
          problemSlug: "warmup-sum",
          sourceCode: "data = input().split()\nprint(int(data[0]) + int(data[1]))\n"
        },
        testcases: [
          {
            expectedStdout: "3\n",
            id: "tc_01",
            isHidden: false,
            stdin: "1 2\n",
            weight: 1
          },
          {
            expectedStdout: "300\n",
            id: "tc_02",
            isHidden: true,
            stdin: "100 200\n",
            weight: 1
          }
        ]
      },
      {
        runSolution
      }
    );

    expect(result.verdict).toBe("accepted");
    expect(result.score).toBe(100);
  });

  it("returns wrong_answer when testcase output differs", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");
    const runSolution = vi.fn().mockResolvedValue({
      durationMs: 5,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "999\n"
    });

    const result = await judgeSubmissionAgainstTestcases(
      {
        draft: {
          language: "python",
          mode: "practice",
          problemSlug: "warmup-sum",
          sourceCode: "print(999)\n"
        },
        testcases: [
          {
            expectedStdout: "3\n",
            id: "tc_01",
            isHidden: false,
            stdin: "1 2\n",
            weight: 1
          }
        ]
      },
      {
        runSolution
      }
    );

    expect(result.verdict).toBe("wrong_answer");
    expect(result.accepted).toBe(false);
  });

  it("returns compile_error for unsupported languages without sandbox execution", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");
    const runSolution = vi.fn();

    const result = await judgeSubmissionAgainstTestcases(
      {
        draft: {
          language: "typescript",
          mode: "practice",
          problemSlug: "warmup-sum",
          sourceCode: "console.log(3)\n"
        },
        testcases: [
          {
            expectedStdout: "3\n",
            id: "tc_01",
            isHidden: false,
            stdin: "1 2\n",
            weight: 1
          }
        ]
      },
      {
        runSolution
      }
    );

    expect(result.verdict).toBe("compile_error");
    expect(runSolution).not.toHaveBeenCalled();
  });
});
