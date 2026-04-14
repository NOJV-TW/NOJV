import { describe, expect, it } from "vitest";

import { canManageContest } from "@nojv/domain";

// After the 2026-04-14 split, contests are always standalone —
// `canManageContest` only checks ownership. Course-role teaching
// rights moved to `canManageExam`; see exam-permissions.test.ts.

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
