import { describe, expect, it } from "vitest";

import { formatChartSummary } from "$lib/utils/chart-summary";

describe("formatChartSummary", () => {
  it("preserves caller-owned labels and values in reading order", () => {
    expect(
      formatChartSummary([
        { label: "Accepted", value: 12 },
        { label: "Wrong answer", value: "3 (20%)" },
      ]),
    ).toBe("Accepted: 12; Wrong answer: 3 (20%)");
  });

  it("returns an empty summary for an empty series", () => {
    expect(formatChartSummary([])).toBe("");
  });
});
