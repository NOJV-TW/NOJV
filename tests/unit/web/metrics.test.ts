import { describe, it, expect } from "vitest";
import { healthProbeDuration, statusClass } from "../../../apps/web/src/lib/server/metrics";

describe("statusClass", () => {
  it("maps HTTP statuses to xx classes", () => {
    expect(statusClass(100)).toBe("1xx");
    expect(statusClass(200)).toBe("2xx");
    expect(statusClass(304)).toBe("3xx");
    expect(statusClass(404)).toBe("4xx");
    expect(statusClass(503)).toBe("5xx");
  });
});

describe("health probe metrics", () => {
  it("exports a dedicated histogram so probes do not enter API SLO metrics", () => {
    expect(healthProbeDuration).toBeDefined();
    expect(typeof healthProbeDuration.record).toBe("function");
  });
});
