import { describe, expect, it } from "vitest";

import { deriveAssignmentWindowState, windowStateColorClass } from "$lib/utils/coursework-path";

describe("deriveAssignmentWindowState", () => {
  const base = {
    closesAt: "2026-03-22T12:00:00.000Z",
    dueAt: "2026-03-20T12:00:00.000Z",
    opensAt: "2026-03-18T12:00:00.000Z",
  };

  it("marks assignment windows as upcoming before opensAt", () => {
    expect(deriveAssignmentWindowState({ ...base, now: "2026-03-18T11:59:00.000Z" })).toBe(
      "upcoming",
    );
  });

  it("marks assignment windows as open between opensAt and dueAt", () => {
    expect(deriveAssignmentWindowState({ ...base, now: "2026-03-19T00:00:00.000Z" })).toBe(
      "open",
    );
  });

  it("marks exactly at opensAt as open", () => {
    expect(deriveAssignmentWindowState({ ...base, now: "2026-03-18T12:00:00.000Z" })).toBe(
      "open",
    );
  });

  it("marks exactly at dueAt as open", () => {
    expect(deriveAssignmentWindowState({ ...base, now: "2026-03-20T12:00:00.000Z" })).toBe(
      "open",
    );
  });

  it("marks between dueAt and closesAt as grace", () => {
    expect(deriveAssignmentWindowState({ ...base, now: "2026-03-21T00:00:00.000Z" })).toBe(
      "grace",
    );
  });

  it("marks exactly at closesAt as grace", () => {
    expect(deriveAssignmentWindowState({ ...base, now: "2026-03-22T12:00:00.000Z" })).toBe(
      "grace",
    );
  });

  it("marks after closesAt as closed", () => {
    expect(deriveAssignmentWindowState({ ...base, now: "2026-03-22T12:00:01.000Z" })).toBe(
      "closed",
    );
  });
});

describe("windowStateColorClass", () => {
  it("returns success token for open state", () => {
    expect(windowStateColorClass("open")).toContain("success");
  });

  it("returns warning token for grace state", () => {
    expect(windowStateColorClass("grace")).toContain("warning");
  });

  it("returns info token for upcoming state", () => {
    expect(windowStateColorClass("upcoming")).toContain("info");
  });

  it("returns muted for closed state", () => {
    expect(windowStateColorClass("closed")).toContain("muted");
  });
});
