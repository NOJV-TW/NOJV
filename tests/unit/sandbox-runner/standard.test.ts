/**
 * Unit tests for the standard-judge canonical output normalization.
 *
 * The standard judge applies a single, fixed comparison: CRLF→LF,
 * per-line trailing whitespace stripped, trailing blank lines stripped,
 * exact equality afterward. Float tolerance, case-insensitive matching,
 * and any other comparison semantics belong in a checker, not here.
 */
import { describe, it, expect } from "vitest";

import { compareOutputs } from "../../../apps/sandbox-runner/src/judges/standard.js";

describe("compareOutputs (canonical normalization)", () => {
  it("matches identical strings", () => {
    expect(compareOutputs("hello", "hello")).toBe(true);
  });

  it("treats CRLF and LF as equivalent", () => {
    expect(compareOutputs("a\r\nb\r\nc", "a\nb\nc")).toBe(true);
  });

  it("ignores per-line trailing spaces and tabs", () => {
    expect(compareOutputs("hello   \nworld\t", "hello\nworld")).toBe(true);
  });

  it("ignores trailing blank lines", () => {
    expect(compareOutputs("hello\n\n\n", "hello")).toBe(true);
    expect(compareOutputs("hello\nworld\n\n", "hello\nworld")).toBe(true);
  });

  it("rejects genuinely different content", () => {
    expect(compareOutputs("hello", "world")).toBe(false);
    expect(compareOutputs("1 2 3", "1 2 4")).toBe(false);
  });

  it("is case-sensitive (no more ignore_case mode)", () => {
    expect(compareOutputs("Hello", "hello")).toBe(false);
  });

  it("does not collapse internal whitespace (no more ignore_whitespace mode)", () => {
    expect(compareOutputs("a  b", "a b")).toBe(false);
    expect(compareOutputs("a\tb", "a b")).toBe(false);
  });

  it("does not apply float tolerance (no more float mode)", () => {
    expect(compareOutputs("1.0000001", "1.0")).toBe(false);
  });
});
