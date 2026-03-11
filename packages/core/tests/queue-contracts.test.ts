import { describe, expect, it } from "vitest";
import { queueNames, submissionJudgeJobSchema } from "../src/index";

describe("queue contracts", () => {
  it("uses explicit queue names for dashboard routing", () => {
    expect(queueNames.submission).toBe("submission-judge");
    expect(queueNames.cheatingSignal).toBe("cheating-signal");
  });

  it("validates submission job payload", () => {
    const result = submissionJudgeJobSchema.safeParse({
      submissionId: "sub-123",
      draft: {
        mode: "practice",
        problemSlug: "two-sum",
        language: "python",
        sourceCode: "print('hello')"
      }
    });
    expect(result.success).toBe(true);
  });
});
