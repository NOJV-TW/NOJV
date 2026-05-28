import { describe, expect, it } from "vitest";

import { plagiarismDomain } from "@nojv/domain";

const { boundaryMarkerFor } = plagiarismDomain;

describe("boundaryMarkerFor", () => {
  it("returns `#` for python", () => {
    expect(boundaryMarkerFor("python")).toBe("#");
  });

  it("returns `//` for c", () => {
    expect(boundaryMarkerFor("c")).toBe("//");
  });

  it("returns `//` for cpp", () => {
    expect(boundaryMarkerFor("cpp")).toBe("//");
  });

  it("returns `//` for java", () => {
    expect(boundaryMarkerFor("java")).toBe("//");
  });

  it("returns `//` for javascript", () => {
    expect(boundaryMarkerFor("javascript")).toBe("//");
  });

  it("returns `//` for typescript", () => {
    expect(boundaryMarkerFor("typescript")).toBe("//");
  });

  it("returns `//` for go", () => {
    expect(boundaryMarkerFor("go")).toBe("//");
  });

  it("returns `//` for rust", () => {
    expect(boundaryMarkerFor("rust")).toBe("//");
  });

  it("returns `//` as a safe default for unknown languages", () => {
    expect(boundaryMarkerFor("haskell")).toBe("//");
  });
});
