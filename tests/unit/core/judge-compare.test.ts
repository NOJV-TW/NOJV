import { compareStandard, normalizeOutput } from "@nojv/core";
import { describe, expect, it } from "vitest";

describe("normalizeOutput", () => {
  it("converts CRLF to LF", () => {
    expect(normalizeOutput("a\r\nb")).toBe("a\nb");
  });

  it("strips per-line trailing whitespace", () => {
    expect(normalizeOutput("a   \nb\t\t")).toBe("a\nb");
  });

  it("strips trailing blank lines", () => {
    expect(normalizeOutput("a\nb\n\n\n")).toBe("a\nb");
  });

  it("leaves already-normalized output unchanged", () => {
    expect(normalizeOutput("a\nb")).toBe("a\nb");
  });
});

describe("compareStandard", () => {
  it("treats CRLF/LF as equal", () => {
    expect(compareStandard("a\r\nb", "a\nb")).toBe(true);
  });

  it("treats trailing whitespace and blank lines as equal", () => {
    expect(compareStandard("42  \n\n", "42")).toBe(true);
  });

  it("returns false for genuinely different output", () => {
    expect(compareStandard("42", "43")).toBe(false);
  });
});
