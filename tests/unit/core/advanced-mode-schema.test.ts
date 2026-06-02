import { advancedResultSchema } from "@nojv/core";
import { describe, expect, it } from "vitest";

describe("advancedResultSchema", () => {
  it("accepts a minimal valid result.json", () => {
    const parsed = advancedResultSchema.safeParse({ score: 100, verdict: "accepted" });
    expect(parsed.success).toBe(true);
  });

  it("accepts optional per-case testcases", () => {
    const parsed = advancedResultSchema.safeParse({
      score: 80,
      verdict: "wrong_answer",
      testcases: [{ index: 0, verdict: "WA", runtimeMs: 5, feedback: "nope" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("strips the removed `subtasks` field instead of failing (backward compatible)", () => {
    const parsed = advancedResultSchema.safeParse({
      score: 100,
      verdict: "accepted",
      subtasks: [{ name: "sample", score: 100, passed: true }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "subtasks" in parsed.data).toBe(false);
  });

  it("normalizes short verdict codes to long form", () => {
    expect(advancedResultSchema.parse({ score: 0, verdict: "tle" }).verdict).toBe(
      "time_limit_exceeded",
    );
    expect(advancedResultSchema.parse({ score: 0, verdict: "AC" }).verdict).toBe("accepted");
    expect(advancedResultSchema.parse({ score: 0, verdict: "wa" }).verdict).toBe(
      "wrong_answer",
    );
    expect(advancedResultSchema.parse({ score: 0, verdict: "mle" }).verdict).toBe(
      "memory_limit_exceeded",
    );
    expect(advancedResultSchema.parse({ score: 0, verdict: "re" }).verdict).toBe(
      "runtime_error",
    );
    expect(advancedResultSchema.parse({ score: 0, verdict: "ce" }).verdict).toBe(
      "compile_error",
    );
  });

  it("still accepts canonical long verdict forms", () => {
    expect(
      advancedResultSchema.parse({ score: 0, verdict: "time_limit_exceeded" }).verdict,
    ).toBe("time_limit_exceeded");
  });

  it("rejects an unknown verdict", () => {
    const parsed = advancedResultSchema.safeParse({ score: 100, verdict: "almost" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a score out of [0, 100]", () => {
    expect(advancedResultSchema.safeParse({ score: 101, verdict: "accepted" }).success).toBe(
      false,
    );
    expect(advancedResultSchema.safeParse({ score: -1, verdict: "accepted" }).success).toBe(
      false,
    );
  });
});
