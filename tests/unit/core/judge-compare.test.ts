import { compareStandard } from "@nojv/core";
import { describe, expect, it } from "vitest";

describe("compareStandard — token-based (DOMjudge default semantics)", () => {
  describe("whitespace / newline (always merged, not configurable)", () => {
    it("treats CRLF and LF as equal", () => {
      expect(compareStandard("a\r\nb", "a\nb")).toBe(true);
    });

    it("collapses any run of whitespace, incl. multiple spaces", () => {
      expect(compareStandard("1  2   3", "1 2 3")).toBe(true);
    });

    it("treats a newline as equivalent to a space (full tokenization)", () => {
      expect(compareStandard("1\n2", "1 2")).toBe(true);
    });

    it("ignores leading/trailing whitespace and trailing blank lines", () => {
      expect(compareStandard("  42  \n\n", "42")).toBe(true);
    });

    it("treats two empty / whitespace-only outputs as equal", () => {
      expect(compareStandard("   \n ", "")).toBe(true);
    });
  });

  describe("token content", () => {
    it("returns false for genuinely different tokens", () => {
      expect(compareStandard("42", "43")).toBe(false);
    });

    it("returns false when token counts differ", () => {
      expect(compareStandard("1 2", "1 2 3")).toBe(false);
      expect(compareStandard("1", "")).toBe(false);
    });
  });

  describe("case sensitivity (default: sensitive)", () => {
    it("is case-sensitive by default", () => {
      expect(compareStandard("Yes", "yes")).toBe(false);
    });

    it("folds case when caseSensitive=false", () => {
      expect(compareStandard("Yes", "yes", { caseSensitive: false })).toBe(true);
      expect(compareStandard("HELLO world", "hello WORLD", { caseSensitive: false })).toBe(
        true,
      );
    });
  });

  describe("float tolerance (default: none / exact string compare)", () => {
    it("compares numeric tokens as exact strings when no tolerance is set", () => {
      expect(compareStandard("1.0", "1.00")).toBe(false);
      expect(compareStandard("0.1", "0.2")).toBe(false);
    });

    it("accepts within absolute tolerance", () => {
      expect(compareStandard("1.0000001", "1.0", { floatTolerance: 1e-6 })).toBe(true);
      expect(compareStandard("3.14159", "3.14160", { floatTolerance: 1e-4 })).toBe(true);
    });

    it("rejects outside absolute tolerance", () => {
      expect(compareStandard("3.14159", "3.14160", { floatTolerance: 1e-6 })).toBe(false);
    });

    it("accepts via relative tolerance for large magnitudes", () => {
      // abs diff 0.5 > 1e-6, but relative 0.5/1e6 = 5e-7 <= 1e-6
      expect(compareStandard("1000000.5", "1000000", { floatTolerance: 1e-6 })).toBe(true);
    });

    it("treats equal numeric values written differently as equal under tolerance", () => {
      expect(compareStandard("1.0", "1.00", { floatTolerance: 1e-9 })).toBe(true);
    });

    it("only relaxes numeric tokens — text tokens are still compared exactly", () => {
      expect(compareStandard("abc", "abd", { floatTolerance: 1e-6 })).toBe(false);
    });
  });
});
