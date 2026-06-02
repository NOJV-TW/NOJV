/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { formatSmartTimestamp } from "$lib/utils/datetime";

const now = new Date(2026, 5, 2, 15, 30);

describe("formatSmartTimestamp", () => {
  it("returns an empty string for invalid input", () => {
    expect(formatSmartTimestamp("", now)).toBe("");
  });

  it("shows time only on the same day (no year)", () => {
    const result = formatSmartTimestamp(new Date(2026, 5, 2, 9, 5), now);
    expect(result).not.toContain("2026");
  });

  it("adds the date on a different day in the same year (still no year)", () => {
    const sameDay = formatSmartTimestamp(new Date(2026, 5, 2, 9, 5), now);
    const otherDay = formatSmartTimestamp(new Date(2026, 2, 1, 9, 5), now);
    expect(otherDay).not.toContain("2026");
    expect(otherDay.length).toBeGreaterThan(sameDay.length);
  });

  it("adds the year on a different year", () => {
    const otherYear = formatSmartTimestamp(new Date(2024, 2, 1, 9, 5), now);
    expect(otherYear).toContain("2024");
  });
});
