/**
 * Unit tests for the standard-judge canonical output normalization.
 *
 * The standard judge applies a single, fixed comparison: CRLF→LF,
 * per-line trailing whitespace stripped, trailing blank lines stripped,
 * exact equality afterward. Float tolerance, case-insensitive matching,
 * and any other comparison semantics belong in a checker, not here.
 */
import { describe, it, expect } from "vitest";

import { compareStandard } from "@nojv/core";

describe("compareStandard (canonical normalization)", () => {
  it("matches identical strings", () => {
    expect(compareStandard("hello", "hello")).toBe(true);
  });

  it("treats CRLF and LF as equivalent", () => {
    expect(compareStandard("a\r\nb\r\nc", "a\nb\nc")).toBe(true);
  });

  it("ignores per-line trailing spaces and tabs", () => {
    expect(compareStandard("hello   \nworld\t", "hello\nworld")).toBe(true);
  });

  it("ignores trailing blank lines", () => {
    expect(compareStandard("hello\n\n\n", "hello")).toBe(true);
    expect(compareStandard("hello\nworld\n\n", "hello\nworld")).toBe(true);
  });

  it("rejects genuinely different content", () => {
    expect(compareStandard("hello", "world")).toBe(false);
    expect(compareStandard("1 2 3", "1 2 4")).toBe(false);
  });

  it("is case-sensitive (no more ignore_case mode)", () => {
    expect(compareStandard("Hello", "hello")).toBe(false);
  });

  it("does not collapse internal whitespace (no more ignore_whitespace mode)", () => {
    expect(compareStandard("a  b", "a b")).toBe(false);
    expect(compareStandard("a\tb", "a b")).toBe(false);
  });

  it("does not apply float tolerance (no more float mode)", () => {
    expect(compareStandard("1.0000001", "1.0")).toBe(false);
  });
});
