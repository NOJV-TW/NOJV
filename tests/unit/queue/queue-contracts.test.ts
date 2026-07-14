import { describe, expect, it } from "vitest";
import { submissionJudgeJobSchema } from "@nojv/core";

describe("queue contracts", () => {
  it("validates submission job payload", () => {
    const result = submissionJudgeJobSchema.safeParse({
      submissionId: "sub-123",
      draft: {
        problemId: "two-sum",
        language: "python",
        sourceCode: "print('hello')",
      },
    });
    expect(result.success).toBe(true);
  });
});
