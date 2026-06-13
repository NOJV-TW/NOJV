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

  it("collapses internal whitespace runs (DOMjudge token semantics)", () => {
    expect(compareStandard("a  b", "a b")).toBe(true);
    expect(compareStandard("a\tb", "a b")).toBe(true);
  });

  it("does not apply float tolerance by default (exact unless opted in)", () => {
    expect(compareStandard("1.0000001", "1.0")).toBe(false);
  });
});
