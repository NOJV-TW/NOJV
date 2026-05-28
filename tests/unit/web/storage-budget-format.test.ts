import { describe, expect, it } from "vitest";

import { formatBudget } from "../../../apps/web/src/lib/utils/storage-budget-format";

describe("formatBudget", () => {
  const LIMIT = 50 * 1024 * 1024;

  it("renders sub-MB usage in KB", () => {
    expect(formatBudget(512 * 1024, LIMIT)).toBe("512 KB / 50 MB");
  });

  it("renders MB usage with one decimal under 10 MB", () => {
    expect(formatBudget(Math.round(2.345 * 1024 * 1024), LIMIT)).toBe("2.3 MB / 50 MB");
  });

  it("still renders when usage exceeds the limit", () => {
    expect(formatBudget(60 * 1024 * 1024, LIMIT)).toBe("60 MB / 50 MB");
  });
});
