import { describe, it, expect } from "vitest";
import { deriveAssessmentWindowState } from "$lib/types";

describe("deriveAssessmentWindowState", () => {
  const base = {
    closesAt: "2099-01-03T00:00:00.000Z",
    dueAt: "2099-01-02T00:00:00.000Z",
    opensAt: "2099-01-01T00:00:00.000Z"
  };

  it("returns 'upcoming' when now is before opensAt", () => {
    const state = deriveAssessmentWindowState({
      ...base,
      now: "2024-01-01T00:00:00.000Z"
    });
    expect(state).toBe("upcoming");
  });

  it("returns 'open' when now is between opensAt and dueAt", () => {
    const state = deriveAssessmentWindowState({
      ...base,
      now: "2099-01-01T12:00:00.000Z"
    });
    expect(state).toBe("open");
  });

  it("returns 'grace' when now is between dueAt and closesAt", () => {
    const state = deriveAssessmentWindowState({
      ...base,
      now: "2099-01-02T12:00:00.000Z"
    });
    expect(state).toBe("grace");
  });

  it("returns 'closed' when now is after closesAt", () => {
    const state = deriveAssessmentWindowState({
      ...base,
      now: "2099-01-04T00:00:00.000Z"
    });
    expect(state).toBe("closed");
  });

  it("returns 'open' exactly at opensAt boundary", () => {
    const state = deriveAssessmentWindowState({
      ...base,
      now: "2099-01-01T00:00:00.000Z"
    });
    expect(state).toBe("open");
  });

  it("returns 'open' exactly at dueAt boundary", () => {
    const state = deriveAssessmentWindowState({
      ...base,
      now: "2099-01-02T00:00:00.000Z"
    });
    expect(state).toBe("open");
  });

  it("returns 'grace' exactly at closesAt boundary", () => {
    const state = deriveAssessmentWindowState({
      ...base,
      now: "2099-01-03T00:00:00.000Z"
    });
    expect(state).toBe("grace");
  });
});
