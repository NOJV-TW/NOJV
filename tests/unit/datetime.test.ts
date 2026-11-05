/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { formatSmartTimestamp } from "#lib/utils/datetime.js";

const now = new Date("2026-06-02T15:30:00+08:00");

describe("formatSmartTimestamp", () => {
  it("returns an empty string for invalid input", () => {
    expect(formatSmartTimestamp("", now)).toBe("");
  });

  it("shows time only on the same day (no year)", () => {
    const result = formatSmartTimestamp(new Date("2026-06-02T09:05:00+08:00"), now);
    expect(result).not.toContain("2026");
  });

  it("adds the date on a different day in the same year (still no year)", () => {
    const sameDay = formatSmartTimestamp(new Date("2026-06-02T09:05:00+08:00"), now);
    const otherDay = formatSmartTimestamp(new Date("2026-03-01T09:05:00+08:00"), now);
    expect(otherDay).not.toContain("2026");
    expect(otherDay.length).toBeGreaterThan(sameDay.length);
  });

  it("adds the year on a different year", () => {
    const otherYear = formatSmartTimestamp(new Date("2024-03-01T09:05:00+08:00"), now);
    expect(otherYear).toContain("2024");
  });
});
