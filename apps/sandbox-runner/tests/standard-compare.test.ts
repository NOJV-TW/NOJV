/**
 * Unit tests for the standard-judge compare-mode dispatch. These cover
 * the pure string-comparison layer — no process execution required.
 */
import { describe, it, expect } from "vitest";
import type { Compare } from "@nojv/core";

import { compareOutputs } from "../src/judges/standard.js";

describe("compareOutputs: exact", () => {
  const mode: Compare = { mode: "exact" };

  it("trims trailing whitespace/newlines on both sides", () => {
    expect(compareOutputs("hello\n", "hello", mode)).toBe(true);
    expect(compareOutputs("hello\n\n", "hello", mode)).toBe(true);
    expect(compareOutputs("hello", "hello   \n", mode)).toBe(true);
  });

  it("rejects mid-string whitespace differences", () => {
    expect(compareOutputs("a b", "a  b", mode)).toBe(false);
    expect(compareOutputs("a\nb", "a b", mode)).toBe(false);
  });

  it("is case-sensitive by default", () => {
    expect(compareOutputs("Hello", "hello", mode)).toBe(false);
  });

  it("falls back to exact when compare is undefined", () => {
    expect(compareOutputs("hello\n", "hello", undefined)).toBe(true);
    expect(compareOutputs("foo", "bar", undefined)).toBe(false);
  });
});

describe("compareOutputs: ignore_whitespace", () => {
  const mode: Compare = { mode: "ignore_whitespace" };

  it("collapses runs of whitespace on both sides", () => {
    expect(compareOutputs("a b\nc", "a  b c", mode)).toBe(true);
    expect(compareOutputs("a\t\tb", "a b", mode)).toBe(true);
  });

  it("ignores leading/trailing whitespace", () => {
    expect(compareOutputs("  hello world  ", "hello world", mode)).toBe(true);
  });

  it("still detects genuinely different tokens", () => {
    expect(compareOutputs("a b c", "a b d", mode)).toBe(false);
  });
});

describe("compareOutputs: ignore_case", () => {
  const mode: Compare = { mode: "ignore_case" };

  it("matches regardless of case", () => {
    expect(compareOutputs("HELLO", "hello", mode)).toBe(true);
    expect(compareOutputs("Hello World", "hello world", mode)).toBe(true);
  });

  it("still requires exact whitespace (orthogonal to ignore_whitespace)", () => {
    expect(compareOutputs("hello  world", "hello world", mode)).toBe(false);
  });

  it("rejects genuinely different letters", () => {
    expect(compareOutputs("Hello", "Helps", mode)).toBe(false);
  });
});

describe("compareOutputs: float", () => {
  const mode: Compare = { mode: "float" };

  it("matches within default tolerance", () => {
    // |1.0000001 - 1.0| = 1e-7, within default absTol of 1e-6
    expect(compareOutputs("1.0000001 2.5", "1.0 2.5", mode)).toBe(true);
    // |1.001 - 1.0| = 1e-3, well outside 1e-6
    expect(compareOutputs("1.001 2.5", "1.0 2.5", mode)).toBe(false);
  });

  it("rejects values outside tolerance", () => {
    expect(compareOutputs("1.1 2.5", "1.0 2.5", mode)).toBe(false);
  });

  it("honors explicit absolute tolerance", () => {
    const loose: Compare = { mode: "float", floatAbsTol: 0.5 };
    expect(compareOutputs("1.3", "1.0", loose)).toBe(true);
    expect(compareOutputs("1.6", "1.0", loose)).toBe(false);
  });

  it("handles mixed numeric + string tokens", () => {
    expect(compareOutputs("hello 1.0", "hello 1.0000001", mode)).toBe(true);
    expect(compareOutputs("hello 1.0", "world 1.0", mode)).toBe(false);
  });

  it("returns false when token counts differ", () => {
    expect(compareOutputs("1 2 3", "1 2", mode)).toBe(false);
  });

  it("uses relative tolerance for large magnitudes", () => {
    const rel: Compare = { mode: "float", floatAbsTol: 0, floatRelTol: 1e-3 };
    // |1000000 - 1000500| = 500, tolerance = 1e-3 * 1000500 = 1000.5 → match
    expect(compareOutputs("1000500", "1000000", rel)).toBe(true);
  });
});

describe("compareOutputs: regex_filter", () => {
  it("strips lines matching the configured patterns before comparing", () => {
    const mode: Compare = {
      mode: "regex_filter",
      ignoreLinePatterns: ["^time: "]
    };
    expect(compareOutputs("time: 123\nresult: 42", "time: 456\nresult: 42", mode)).toBe(true);
  });

  it("still catches non-filtered differences", () => {
    const mode: Compare = {
      mode: "regex_filter",
      ignoreLinePatterns: ["^time: "]
    };
    expect(compareOutputs("time: 123\nresult: 42", "time: 456\nresult: 43", mode)).toBe(false);
  });

  it("with empty patterns falls through to exact", () => {
    const mode: Compare = { mode: "regex_filter", ignoreLinePatterns: [] };
    expect(compareOutputs("hello\n", "hello", mode)).toBe(true);
    expect(compareOutputs("foo", "bar", mode)).toBe(false);
  });
});
