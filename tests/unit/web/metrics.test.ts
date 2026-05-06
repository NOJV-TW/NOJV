import { describe, it, expect } from "vitest";
import { statusClass } from "../../../apps/web/src/lib/server/metrics";

describe("statusClass", () => {
  it("maps HTTP statuses to xx classes", () => {
    expect(statusClass(100)).toBe("1xx");
    expect(statusClass(200)).toBe("2xx");
    expect(statusClass(304)).toBe("3xx");
    expect(statusClass(404)).toBe("4xx");
    expect(statusClass(503)).toBe("5xx");
  });
});
