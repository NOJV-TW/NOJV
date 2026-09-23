import { describe, expect, it } from "vitest";

import { examDomain } from "@nojv/application";

const { resolveScoredState } = examDomain;

describe("resolveScoredState — per-problem max = problem total", () => {
  it("marks ac only when score reaches the problem total", () => {
    expect(resolveScoredState(200, 200)).toBe("ac");
    expect(resolveScoredState(250, 200)).toBe("ac");
  });

  it("marks partial when score is positive but below the problem total", () => {
    expect(resolveScoredState(199, 200)).toBe("partial");
    expect(resolveScoredState(1, 200)).toBe("partial");
  });

  it("marks zero when the score is zero", () => {
    expect(resolveScoredState(0, 200)).toBe("zero");
  });
});
