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
  it("returns 100 for special_env (advanced) problems", () => {
    expect(computeProblemTotalScore({ type: "special_env", testcaseSets: [] })).toBe(100);
  });
  it("returns 100 when a standard problem has no testcase sets yet", () => {
    expect(computeProblemTotalScore({ type: "full_source", testcaseSets: [] })).toBe(100);
  });
});
