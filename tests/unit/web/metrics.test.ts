import { error, redirect } from "@sveltejs/kit";
import { describe, it, expect } from "vitest";
import {
  healthProbeDuration,
  statusClass,
  thrownStatus,
} from "../../../apps/web/src/lib/server/metrics";

describe("statusClass", () => {
  it("maps HTTP statuses to xx classes", () => {
    expect(statusClass(100)).toBe("1xx");
    expect(statusClass(200)).toBe("2xx");
    expect(statusClass(304)).toBe("3xx");
    expect(statusClass(404)).toBe("4xx");
    expect(statusClass(503)).toBe("5xx");
  });
});

describe("thrownStatus", () => {
  function caught(fn: () => never): unknown {
    try {
      fn();
    } catch (err) {
      return err;
    }
  }

  it("records the status the client receives for thrown redirects and errors", () => {
    expect(thrownStatus(caught(() => redirect(302, "/complete-profile")))).toBe(302);
    expect(thrownStatus(caught(() => error(403, "Forbidden")))).toBe(403);
    expect(thrownStatus(new Error("boom"))).toBe(500);
  });
});

describe("health probe metrics", () => {
  it("exports a dedicated histogram so probes do not enter API SLO metrics", () => {
    expect(healthProbeDuration).toBeDefined();
    expect(typeof healthProbeDuration.record).toBe("function");
  });
});
