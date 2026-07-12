import {
  advancedConfigSchema,
  advancedResultSchema,
  validateAdvancedResultForMaxScore,
} from "@nojv/core";
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

  it("accepts a score above 100 (advanced problems can declare a larger total)", () => {
    expect(advancedResultSchema.safeParse({ score: 250, verdict: "accepted" }).success).toBe(
      true,
    );
  });

  it("rejects a score out of [0, 100_000]", () => {
    expect(
      advancedResultSchema.safeParse({ score: 100_001, verdict: "accepted" }).success,
    ).toBe(false);
    expect(advancedResultSchema.safeParse({ score: -1, verdict: "accepted" }).success).toBe(
      false,
    );
  });

  it("rejects fractional scores because submissions persist integer scores", () => {
    expect(
      advancedResultSchema.safeParse({ score: 1.5, verdict: "wrong_answer" }).success,
    ).toBe(false);
  });

  it("validates score against the problem max score", () => {
    expect(
      validateAdvancedResultForMaxScore({ score: 101, verdict: "wrong_answer" }, 100),
    ).toContain("score 101 exceeds maxScore 100");
    expect(validateAdvancedResultForMaxScore({ score: 100, verdict: "accepted" }, 100)).toEqual(
      [],
    );
    expect(
      validateAdvancedResultForMaxScore({ score: 60, verdict: "accepted" }, 100),
    ).toContain("accepted verdict requires score to equal maxScore");
  });
});

describe("advancedConfigSchema", () => {
  const run = { imageRef: "run:latest", imageSource: "registry" as const };
  const grade = { imageRef: "grade:latest", imageSource: "registry" as const };

  it("rejects a non-registry imageSource", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade: { imageRef: "grade:latest", imageSource: "tarball" },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a config with network.mode none (default applied)", () => {
    const parsed = advancedConfigSchema.safeParse({ run, grade });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.network.mode).toBe("none");
  });

  it("defaults maxScore to 100 when omitted", () => {
    const parsed = advancedConfigSchema.safeParse({ run, grade });
    expect(parsed.success && parsed.data.maxScore).toBe(100);
  });

  it("accepts an explicit maxScore above 100", () => {
    const parsed = advancedConfigSchema.safeParse({ run, grade, maxScore: 250 });
    expect(parsed.success && parsed.data.maxScore).toBe(250);
  });

  it("rejects a maxScore below 1", () => {
    expect(advancedConfigSchema.safeParse({ run, grade, maxScore: 0 }).success).toBe(false);
  });

  it("accepts an explicit network.mode none", () => {
    const parsed = advancedConfigSchema.safeParse({ run, grade, network: { mode: "none" } });
    expect(parsed.success).toBe(true);
  });

  it("accepts a config with network.mode allowlist and a non-empty allowlist", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: { mode: "allowlist", allowlist: ["api.example.com:443"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a config with network.mode service and a service image", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: { mode: "service", service: { imageRef: "svc:1", imageSource: "registry" } },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a config missing grade", () => {
    const parsed = advancedConfigSchema.safeParse({ run });
    expect(parsed.success).toBe(false);
  });

  it("rejects a config missing run", () => {
    const parsed = advancedConfigSchema.safeParse({ grade });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty image ref", () => {
    const parsed = advancedConfigSchema.safeParse({
      run: { imageRef: "", imageSource: "registry" },
      grade,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an image ref longer than 500 chars", () => {
    const parsed = advancedConfigSchema.safeParse({
      run: { imageRef: "a".repeat(501), imageSource: "registry" },
      grade,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid imageSource", () => {
    const parsed = advancedConfigSchema.safeParse({
      run: { imageRef: "run:latest", imageSource: "docker" },
      grade,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects allowlist mode with an absent allowlist", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: { mode: "allowlist" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects allowlist mode with an empty allowlist", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: { mode: "allowlist", allowlist: [] },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects allowlist mode that also carries a service", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: {
        mode: "allowlist",
        allowlist: ["api.example.com:443"],
        service: { imageRef: "svc:1", imageSource: "registry" },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects service mode without a service", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: { mode: "service" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects service mode that also carries an allowlist", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: {
        mode: "service",
        service: { imageRef: "svc:1", imageSource: "registry" },
        allowlist: ["api.example.com:443"],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects none mode that carries an allowlist", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: { mode: "none", allowlist: ["api.example.com:443"] },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects none mode that carries a service", () => {
    const parsed = advancedConfigSchema.safeParse({
      run,
      grade,
      network: { mode: "none", service: { imageRef: "svc:1", imageSource: "registry" } },
    });
    expect(parsed.success).toBe(false);
  });
});
