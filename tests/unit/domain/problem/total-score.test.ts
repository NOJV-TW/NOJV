import { describe, expect, it } from "vitest";
import { computeProblemTotalScore } from "@nojv/application";

describe("computeProblemTotalScore", () => {
  it("sums subtask weights for standard problems", () => {
    expect(
      computeProblemTotalScore({
        type: "full_source",
        testcaseSets: [{ weight: 80 }, { weight: 120 }],
      }),
    ).toBe(200);
  });
  it("returns 100 for special_env (advanced) problems with no advancedConfig", () => {
    expect(computeProblemTotalScore({ type: "special_env", testcaseSets: [] })).toBe(100);
  });
  it("returns the declared maxScore for special_env problems", () => {
    expect(
      computeProblemTotalScore({
        type: "special_env",
        testcaseSets: [],
        advancedConfig: {
          run: { imageRef: "run:latest", imageSource: "registry" },
          grade: { imageRef: "grade:latest", imageSource: "registry" },
          network: { mode: "none" },
          maxScore: 250,
        },
      }),
    ).toBe(250);
  });
  it("returns 100 for special_env when advancedConfig is invalid", () => {
    expect(
      computeProblemTotalScore({
        type: "special_env",
        testcaseSets: [],
        advancedConfig: { bogus: true },
      }),
    ).toBe(100);
  });
  it("defaults special_env maxScore to 100 when advancedConfig omits it", () => {
    expect(
      computeProblemTotalScore({
        type: "special_env",
        testcaseSets: [],
        advancedConfig: {
          run: { imageRef: "run:latest", imageSource: "registry" },
          grade: { imageRef: "grade:latest", imageSource: "registry" },
        },
      }),
    ).toBe(100);
  });
  it("returns 100 when a standard problem has no testcase sets yet", () => {
    expect(computeProblemTotalScore({ type: "full_source", testcaseSets: [] })).toBe(100);
  });
});
