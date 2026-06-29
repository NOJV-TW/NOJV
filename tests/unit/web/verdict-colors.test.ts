import { describe, expect, it } from "vitest";

import { formatVerdictLabel, verdictBadgeVariant, verdictTone } from "$lib/utils/verdict-style";

describe("verdictBadgeVariant", () => {
  it("maps accepted to verdict-ac", () => {
    expect(verdictBadgeVariant("accepted")).toBe("verdict-ac");
  });

  it("maps wrong_answer to verdict-wa", () => {
    expect(verdictBadgeVariant("wrong_answer")).toBe("verdict-wa");
  });

  it("maps runtime_error to verdict-re", () => {
    expect(verdictBadgeVariant("runtime_error")).toBe("verdict-re");
  });

  it("maps compile_error to verdict-ce", () => {
    expect(verdictBadgeVariant("compile_error")).toBe("verdict-ce");
  });

  it("maps time_limit_exceeded to verdict-tle", () => {
    expect(verdictBadgeVariant("time_limit_exceeded")).toBe("verdict-tle");
  });

  it("maps memory_limit_exceeded to verdict-mle", () => {
    expect(verdictBadgeVariant("memory_limit_exceeded")).toBe("verdict-mle");
  });

  it("maps pre-terminal statuses to verdict-pending", () => {
    expect(verdictBadgeVariant("pending_upload")).toBe("verdict-pending");
    expect(verdictBadgeVariant("queued")).toBe("verdict-pending");
    expect(verdictBadgeVariant("running")).toBe("verdict-pending");
    expect(verdictBadgeVariant("compiling")).toBe("verdict-pending");
  });

  it("normalizes sandbox short codes", () => {
    expect(verdictBadgeVariant("AC")).toBe("verdict-ac");
    expect(verdictBadgeVariant("WA")).toBe("verdict-wa");
    expect(verdictBadgeVariant("TLE")).toBe("verdict-tle");
    expect(verdictBadgeVariant("MLE")).toBe("verdict-mle");
    expect(verdictBadgeVariant("RE")).toBe("verdict-re");
    expect(verdictBadgeVariant("CE")).toBe("verdict-ce");
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
