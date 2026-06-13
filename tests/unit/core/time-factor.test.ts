import { describe, expect, it } from "vitest";

import { LANGUAGE_TIME_FACTOR, effectiveTimeLimitMs, supportedLanguages } from "@nojv/core";

describe("LANGUAGE_TIME_FACTOR", () => {
  it("defines a factor for every supported language", () => {
    for (const language of supportedLanguages) {
      expect(LANGUAGE_TIME_FACTOR[language]).toBeTypeOf("number");
      expect(LANGUAGE_TIME_FACTOR[language]).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps compiled-native languages at factor 1.0", () => {
    expect(LANGUAGE_TIME_FACTOR.c).toBe(1);
    expect(LANGUAGE_TIME_FACTOR.cpp).toBe(1);
    expect(LANGUAGE_TIME_FACTOR.rust).toBe(1);
  });
});

describe("effectiveTimeLimitMs", () => {
  it("leaves native languages unchanged", () => {
    expect(effectiveTimeLimitMs(1000, "cpp")).toBe(1000);
  });

  it("scales Java/Python by their factor", () => {
    expect(effectiveTimeLimitMs(1000, "java")).toBe(2000);
    expect(effectiveTimeLimitMs(1000, "python")).toBe(3000);
  });

  it("rounds the scaled limit up to the next millisecond", () => {
    expect(effectiveTimeLimitMs(333, "go")).toBe(Math.ceil(333 * 1.5));
  });
});
