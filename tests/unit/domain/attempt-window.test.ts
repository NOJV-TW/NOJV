import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/domain";

const { attemptWindowStart } = submissionDomain;

// Asia/Taipei is a fixed UTC+8 offset year-round (no DST). The window start is
// the most recent moment the Taipei wall-clock passed the configured
// minute-of-day, expressed as a real UTC instant.
describe("attemptWindowStart", () => {
  it("minute 0 (Taipei midnight) returns UTC 16:00 of the previous day", () => {
    // now UTC 10:00 → Taipei 18:00 same day → window = Taipei 2026-06-04 00:00
    const now = new Date("2026-06-04T10:00:00Z");
    expect(attemptWindowStart(0, now).toISOString()).toBe("2026-06-03T16:00:00.000Z");
  });

  it("rolls back to yesterday's reset when Taipei clock has not reached the minute", () => {
    // reset 06:30 (390); now UTC 22:00 → Taipei next day 06:00 < 06:30
    const now = new Date("2026-06-03T22:00:00Z");
    expect(attemptWindowStart(390, now).toISOString()).toBe("2026-06-02T22:30:00.000Z");
  });

  it("uses today's reset when Taipei clock is past the minute", () => {
    // reset 06:30 (390); now UTC 23:00 → Taipei 07:00 > 06:30
    const now = new Date("2026-06-03T23:00:00Z");
    expect(attemptWindowStart(390, now).toISOString()).toBe("2026-06-03T22:30:00.000Z");
  });

  it("treats the exact reset minute as the start of the new window", () => {
    // reset 06:30 (390); now UTC 22:30 → Taipei 06:30 exactly → window starts now
    const now = new Date("2026-06-03T22:30:00Z");
    expect(attemptWindowStart(390, now).toISOString()).toBe("2026-06-03T22:30:00.000Z");
  });

  it("handles year boundary", () => {
    // reset 00:00; now UTC 02:00 → Taipei 2026-01-01 10:00 → window = Taipei 2026-01-01 00:00
    const now = new Date("2026-01-01T02:00:00Z");
    expect(attemptWindowStart(0, now).toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });
});
