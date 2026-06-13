import { describe, expect, it } from "vitest";

import { isViolationLogDue } from "@nojv/application";

const now = new Date("2026-05-26T10:00:00Z");

describe("isViolationLogDue", () => {
  it("logs when there is no prior violation", () => {
    expect(isViolationLogDue(null, now, 60)).toBe(true);
  });

  it("suppresses a repeat inside the throttle window", () => {
    const lastAt = new Date("2026-05-26T09:59:30Z"); // 30s ago
    expect(isViolationLogDue(lastAt, now, 60)).toBe(false);
  });

  it("logs again once the window has elapsed exactly", () => {
    const lastAt = new Date("2026-05-26T09:59:00Z"); // 60s ago
    expect(isViolationLogDue(lastAt, now, 60)).toBe(true);
  });

  it("logs again well past the window", () => {
    const lastAt = new Date("2026-05-26T09:58:00Z"); // 120s ago
    expect(isViolationLogDue(lastAt, now, 60)).toBe(true);
  });
});
