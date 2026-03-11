import { describe, it, expect } from "vitest";
import { deriveAssessmentWindowState } from "$lib/types";

describe("deriveAssessmentWindowState", () => {
  it("returns 'upcoming' when now is before opensAt", () => {
    const state = deriveAssessmentWindowState({
      opensAt: "2099-01-01T00:00:00.000Z",
      dueAt: "2099-01-02T00:00:00.000Z",
      closesAt: "2099-01-03T00:00:00.000Z",
      now: "2024-01-01T00:00:00.000Z"
    });
    expect(state).toBe("upcoming");
  });
});
