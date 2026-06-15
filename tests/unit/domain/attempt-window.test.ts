import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";

const { attemptWindowStart } = submissionDomain;

describe("attemptWindowStart", () => {
  it("minute 0 (Taipei midnight) returns UTC 16:00 of the previous day", () => {
    const now = new Date("2026-06-04T10:00:00Z");
    expect(attemptWindowStart(0, now).toISOString()).toBe("2026-06-03T16:00:00.000Z");
  });

  it("rolls back to yesterday's reset when Taipei clock has not reached the minute", () => {
    const now = new Date("2026-06-03T22:00:00Z");
    expect(attemptWindowStart(390, now).toISOString()).toBe("2026-06-02T22:30:00.000Z");
  });

  it("uses today's reset when Taipei clock is past the minute", () => {
    const now = new Date("2026-06-03T23:00:00Z");
    expect(attemptWindowStart(390, now).toISOString()).toBe("2026-06-03T22:30:00.000Z");
  });

  it("treats the exact reset minute as the start of the new window", () => {
    const now = new Date("2026-06-03T22:30:00Z");
    expect(attemptWindowStart(390, now).toISOString()).toBe("2026-06-03T22:30:00.000Z");
  });

  it("handles year boundary", () => {
    const now = new Date("2026-01-01T02:00:00Z");
    expect(attemptWindowStart(0, now).toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });
});
