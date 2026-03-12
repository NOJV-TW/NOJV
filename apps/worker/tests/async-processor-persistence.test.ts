import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSubmissionProcessor } from "../src/processors/submission";

const { markSubmissionRunning, completeSubmission, getSubmissionJudgeContext } = vi.hoisted(() => ({
  markSubmissionRunning: vi.fn(),
  completeSubmission: vi.fn(),
  getSubmissionJudgeContext: vi.fn()
}));

vi.mock("../src/services/judge-db", () => {
  return {
    completeSubmission,
    getSubmissionJudgeContext,
    markSubmissionRunning
  };
});

const mockExecute = vi.fn();

describe("async processor persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks queued submissions running and completes them against the same record", async () => {
    getSubmissionJudgeContext.mockResolvedValue({
      checkerScript: null,
      interactorScript: null,
      judgeType: "standard",
      memoryLimitMb: 256,
      problemSlug: "warmup-sum",
      submissionType: "full_source",
      templates: [],
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

    mockExecute.mockResolvedValue({
      testcaseResults: [
        {
          index: 0,
          verdict: "AC",
          stdout: "3\n",
          stderr: "",
          exitCode: 0,
          timeMs: 14,
          score: 100
        }
      ]
    });

    const processSubmission = createSubmissionProcessor({ execute: mockExecute } as never);

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
});
