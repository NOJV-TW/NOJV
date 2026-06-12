import { describe, expect, it } from "vitest";

import { computeAutoCloseDelayMs } from "../../../apps/worker/src/workflows/exam-auto-close-helpers";

describe("computeAutoCloseDelayMs", () => {
  it("returns the positive delta when endsAt is in the future", () => {
    const now = new Date("2026-04-14T10:00:00.000Z").getTime();
    const endsAt = "2026-04-14T11:30:00.000Z"; // 90 minutes later

    expect(computeAutoCloseDelayMs(endsAt, now)).toBe(90 * 60 * 1000);
  });

  it("returns 0 when endsAt is in the past", () => {
    const now = new Date("2026-04-14T12:00:00.000Z").getTime();
    const endsAt = "2026-04-14T11:00:00.000Z"; // 1 hour earlier

    expect(computeAutoCloseDelayMs(endsAt, now)).toBe(0);
  });

  it("returns 0 when endsAt is exactly now", () => {
    const now = new Date("2026-04-14T10:00:00.000Z").getTime();

    expect(computeAutoCloseDelayMs(new Date(now).toISOString(), now)).toBe(0);
  });

  it("defaults nowMs to Date.now() when omitted", () => {
    const endsAt = new Date(Date.now() + 60_000).toISOString();
    const result = computeAutoCloseDelayMs(endsAt);

    expect(result).toBeGreaterThan(59_000);
    expect(result).toBeLessThanOrEqual(60_000);
  });
});
