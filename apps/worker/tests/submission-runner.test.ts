import { describe, expect, it, vi } from "vitest";

const noopExecuteRun = vi.fn();

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
        executeRun: noopExecuteRun,
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
        executeRun: noopExecuteRun,
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
        executeRun: noopExecuteRun,
        runSolution
      }
    );

    expect(result.verdict).toBe("compile_error");
    expect(runSolution).not.toHaveBeenCalled();
  });

  it("assembles function-mode source before judging", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");

    const runSolution = vi.fn().mockResolvedValue({
      durationMs: 8,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "3\n"
    });

    const result = await judgeSubmissionAgainstTestcases(
      {
        draft: {
          language: "python",
          mode: "practice",
          problemSlug: "add-function",
          sourceCode: "def add(a, b):\n    return a + b\n"
        },
        submissionType: "function",
        templates: [
          {
            driverCode: "# __USER_CODE__\na, b = map(int, input().split())\nprint(add(a, b))\n",
            insertionMarker: "# __USER_CODE__",
            language: "python",
            templateCode: "def add(a, b):\n    # write your code here\n    pass\n"
          }
        ],
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
        executeRun: noopExecuteRun,
        runSolution
      }
    );

    expect(result.verdict).toBe("accepted");
    // Verify the assembled source was passed to sandbox, not the raw user code
    const callArgs = runSolution.mock.calls[0]?.[0] as { draft: { sourceCode: string } };
    expect(callArgs.draft.sourceCode).toContain("def add(a, b):");
    expect(callArgs.draft.sourceCode).toContain("print(add(a, b))");
  });

  it("returns compile_error when function-mode has no template for language", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");
    const runSolution = vi.fn();

    const result = await judgeSubmissionAgainstTestcases(
      {
        draft: {
          language: "cpp",
          mode: "practice",
          problemSlug: "add-function",
          sourceCode: "int add(int a, int b) { return a + b; }"
        },
        submissionType: "function",
        templates: [
          {
            driverCode: "# __USER_CODE__\nprint(add(1,2))\n",
            insertionMarker: "# __USER_CODE__",
            language: "python",
            templateCode: "def add(a, b): pass"
          }
        ],
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
        executeRun: noopExecuteRun,
        runSolution
      }
    );

    expect(result.verdict).toBe("compile_error");
    expect(result.feedback).toContain("No template found");
    expect(runSolution).not.toHaveBeenCalled();
  });

  it("accepts via checker script when checker exits 0", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");

    // First call (runSolution): user program runs, produces output
    const runSolution = vi.fn().mockResolvedValueOnce({
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "3.000001\n"
    });

    // Second call (executeRun): checker script runs, exits 0
    const executeRun = vi.fn().mockResolvedValueOnce({
      durationMs: 5,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "100\n"
    });

    const result = await judgeSubmissionAgainstTestcases(
      {
        checkerScript: "import sys\nsys.exit(0)\n",
        draft: {
          language: "python",
          mode: "practice",
          problemSlug: "float-check",
          sourceCode: "print(3.000001)\n"
        },
        judgeType: "checker",
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
      { executeRun, runSolution }
    );

    expect(result.verdict).toBe("accepted");
    expect(runSolution).toHaveBeenCalledTimes(1);
    expect(executeRun).toHaveBeenCalledTimes(1);
  });

  it("returns wrong_answer when checker exits non-zero", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");

    const runSolution = vi.fn().mockResolvedValueOnce({
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "999\n"
    });

    const executeRun = vi.fn().mockResolvedValueOnce({
      durationMs: 5,
      exitCode: 1,
      stderr: "Expected 3, got 999",
      status: "failed",
      stdout: ""
    });

    const result = await judgeSubmissionAgainstTestcases(
      {
        checkerScript: 'import sys\nprint("Expected 3, got 999", file=sys.stderr)\nsys.exit(1)\n',
        draft: {
          language: "python",
          mode: "practice",
          problemSlug: "float-check",
          sourceCode: "print(999)\n"
        },
        judgeType: "checker",
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
      { executeRun, runSolution }
    );

    expect(result.verdict).toBe("wrong_answer");
    expect(result.feedback).toBe("Expected 3, got 999");
  });

  it("accepts via interactive judge when interactor exits 0", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");

    // Interactive mode: single sandbox run with interactor + user program connected via pipes
    const executeRun = vi.fn().mockResolvedValueOnce({
      durationMs: 15,
      exitCode: 0,
      stderr: "100\nGuessed correctly",
      status: "succeeded",
      stdout: ""
    });

    const runSolution = vi.fn();

    const result = await judgeSubmissionAgainstTestcases(
      {
        draft: {
          language: "python",
          mode: "practice",
          problemSlug: "guess-number",
          sourceCode: "print(42)\nresponse = input()\n"
        },
        interactorScript: 'import sys\nprint("100", file=sys.stderr)\nsys.exit(0)\n',
        judgeType: "interactive",
        testcases: [
          {
            id: "tc_01",
            isHidden: false,
            stdin: "42\n",
            weight: 1
          }
        ]
      },
      { executeRun, runSolution }
    );

    expect(result.verdict).toBe("accepted");
    // Interactive mode uses executeRun, not runSolution
    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(runSolution).not.toHaveBeenCalled();
  });

  it("returns wrong_answer when interactor exits non-zero", async () => {
    const { judgeSubmissionAgainstTestcases } =
      await import("../src/services/submission-runner");

    const executeRun = vi.fn().mockResolvedValueOnce({
      durationMs: 15,
      exitCode: 1,
      stderr: "0\nDid not guess within 20 attempts",
      status: "failed",
      stdout: ""
    });

    const runSolution = vi.fn();

    const result = await judgeSubmissionAgainstTestcases(
      {
        draft: {
          language: "python",
          mode: "practice",
          problemSlug: "guess-number",
          sourceCode: "print(0)\n"
        },
        interactorScript: 'import sys\nprint("0", file=sys.stderr)\nsys.exit(1)\n',
        judgeType: "interactive",
        testcases: [
          {
            id: "tc_01",
            isHidden: false,
            stdin: "42\n",
            weight: 1
          }
        ]
      },
      { executeRun, runSolution }
    );

    expect(result.verdict).toBe("wrong_answer");
    expect(result.feedback).toBe("Did not guess within 20 attempts");
  });
});
