import { describe, expect, it } from "vitest";

import { verdictColor } from "../src/lib/types";

describe("verdictColor", () => {
  it("maps accepted to emerald", () => {
    expect(verdictColor.accepted).toContain("emerald");
  });

  it("maps wrong_answer to red", () => {
    expect(verdictColor.wrong_answer).toContain("red");
  });

  it("maps time_limit_exceeded to red", () => {
    expect(verdictColor.time_limit_exceeded).toContain("red");
  });

  it("maps memory_limit_exceeded to red", () => {
    expect(verdictColor.memory_limit_exceeded).toContain("red");
  });

  it("maps compile_error to amber", () => {
    expect(verdictColor.compile_error).toContain("amber");
  });

  it("maps runtime_error to amber", () => {
    expect(verdictColor.runtime_error).toContain("amber");
  });

  it("returns undefined for unknown verdicts", () => {
    expect(verdictColor.nonexistent_verdict).toBeUndefined();
  });

  it("covers all six standard verdicts", () => {
    const expectedVerdicts = [
      "accepted",
      "compile_error",
      "memory_limit_exceeded",
      "runtime_error",
      "time_limit_exceeded",
      "wrong_answer"
    ];

    expect(Object.keys(verdictColor).sort()).toEqual(expectedVerdicts);
  });
});
