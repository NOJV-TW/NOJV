import { judgeConfigSchema } from "@nojv/core";
import { describe, expect, it } from "vitest";

describe("judgeConfigSchema.compare (standard comparison options)", () => {
  it("defaults caseSensitive to true and leaves floatTolerance unset", () => {
    const parsed = judgeConfigSchema.parse({ type: "standard", compare: {} });
    expect(parsed.compare?.caseSensitive).toBe(true);
    expect(parsed.compare?.floatTolerance ?? null).toBe(null);
  });

  it("accepts an explicit float tolerance and a case-insensitive flag", () => {
    const parsed = judgeConfigSchema.parse({
      type: "standard",
      compare: { caseSensitive: false, floatTolerance: 1e-6 },
    });
    expect(parsed.compare?.caseSensitive).toBe(false);
    expect(parsed.compare?.floatTolerance).toBe(1e-6);
  });

  it("leaves compare unset when omitted", () => {
    const parsed = judgeConfigSchema.parse({ type: "standard" });
    expect(parsed.compare ?? null).toBe(null);
  });

  it("rejects a non-positive or too-large tolerance", () => {
    expect(() =>
      judgeConfigSchema.parse({ type: "standard", compare: { floatTolerance: 0 } }),
    ).toThrow();
    expect(() =>
      judgeConfigSchema.parse({ type: "standard", compare: { floatTolerance: 5 } }),
    ).toThrow();
  });
});
