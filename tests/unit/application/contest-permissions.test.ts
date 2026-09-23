import { describe, expect, it } from "vitest";

import { canManageContest } from "@nojv/application";

const standalone = { createdByUserId: "owner-1" };

describe("canManageContest", () => {
  it("returns false for unauthenticated user", () => {
    expect(canManageContest(null, standalone)).toBe(false);
  });

  it("returns true when user is the contest creator", () => {
    expect(canManageContest("owner-1", standalone)).toBe(true);
  });

  it("returns false for a stranger", () => {
    expect(canManageContest("stranger", standalone)).toBe(false);
  });

  it("returns false for a contest with null createdByUserId", () => {
    expect(canManageContest("user-1", { createdByUserId: null })).toBe(false);
  });
});
