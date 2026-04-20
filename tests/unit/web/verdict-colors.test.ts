import { describe, expect, it } from "vitest";

import { formatVerdictLabel, verdictColor } from "$lib/types";

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

  it("covers all verdicts and operation statuses", () => {
    const expectedKeys = [
      "accepted",
      "compile_error",
      "compiling",
      "memory_limit_exceeded",
      "queued",
      "running",
      "runtime_error",
      "time_limit_exceeded",
      "wrong_answer",
    ];

    expect(Object.keys(verdictColor).sort()).toEqual(expectedKeys);
  });
});

describe("formatVerdictLabel", () => {
  it("formats accepted", () => {
    expect(formatVerdictLabel("accepted")).toBe("Accepted");
  });

  it("formats wrong_answer with spaces and capitalization", () => {
    expect(formatVerdictLabel("wrong_answer")).toBe("Wrong Answer");
  });

  it("formats time_limit_exceeded", () => {
    expect(formatVerdictLabel("time_limit_exceeded")).toBe("Time Limit Exceeded");
  });
});
