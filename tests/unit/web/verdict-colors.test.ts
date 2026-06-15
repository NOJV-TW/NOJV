import { describe, expect, it } from "vitest";

import { formatVerdictLabel, verdictBadgeVariant, verdictTone } from "$lib/utils/verdict-style";

describe("verdictBadgeVariant", () => {
  it("maps accepted to success", () => {
    expect(verdictBadgeVariant("accepted")).toBe("success");
  });

  it("maps wrong_answer to destructive", () => {
    expect(verdictBadgeVariant("wrong_answer")).toBe("destructive");
  });

  it("maps runtime_error to destructive", () => {
    expect(verdictBadgeVariant("runtime_error")).toBe("destructive");
  });

  it("maps compile_error to destructive", () => {
    expect(verdictBadgeVariant("compile_error")).toBe("destructive");
  });

  it("maps time_limit_exceeded to warning", () => {
    expect(verdictBadgeVariant("time_limit_exceeded")).toBe("warning");
  });

  it("maps memory_limit_exceeded to warning", () => {
    expect(verdictBadgeVariant("memory_limit_exceeded")).toBe("warning");
  });

  it("maps pre-terminal statuses to verdict-pending", () => {
    expect(verdictBadgeVariant("pending_upload")).toBe("verdict-pending");
    expect(verdictBadgeVariant("queued")).toBe("verdict-pending");
    expect(verdictBadgeVariant("running")).toBe("verdict-pending");
    expect(verdictBadgeVariant("compiling")).toBe("verdict-pending");
  });

  it("normalizes sandbox short codes", () => {
    expect(verdictBadgeVariant("AC")).toBe("success");
    expect(verdictBadgeVariant("WA")).toBe("destructive");
    expect(verdictBadgeVariant("TLE")).toBe("warning");
    expect(verdictBadgeVariant("MLE")).toBe("warning");
    expect(verdictBadgeVariant("RE")).toBe("destructive");
    expect(verdictBadgeVariant("CE")).toBe("destructive");
  });

  it("falls back to muted for unknown verdicts", () => {
    expect(verdictBadgeVariant("nonexistent_verdict")).toBe("muted");
  });
});

describe("verdictTone", () => {
  it("maps accepted to text-success", () => {
    expect(verdictTone("accepted")).toBe("text-success");
  });

  it("maps wrong_answer to text-destructive", () => {
    expect(verdictTone("wrong_answer")).toBe("text-destructive");
  });

  it("maps time_limit_exceeded to text-warning", () => {
    expect(verdictTone("time_limit_exceeded")).toBe("text-warning");
  });

  it("normalizes sandbox short codes", () => {
    expect(verdictTone("AC")).toBe("text-success");
    expect(verdictTone("TLE")).toBe("text-warning");
  });

  it("falls back to text-foreground for unknown verdicts", () => {
    expect(verdictTone("nonexistent_verdict")).toBe("text-foreground");
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
