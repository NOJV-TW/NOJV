import { describe, expect, it } from "vitest";

import { contestDomain } from "@nojv/application";

const { canAccessContest } = contestDomain;

describe("canAccessContest", () => {
  it("public contests are accessible to anyone", () => {
    expect(
      canAccessContest({ inviteCode: null, isManager: false, hasParticipation: false }),
    ).toBe(true);
  });

  it("private contests are hidden from non-manager non-participants", () => {
    expect(
      canAccessContest({ inviteCode: "abc123", isManager: false, hasParticipation: false }),
    ).toBe(false);
  });

  it("private contests are visible to managers", () => {
    expect(
      canAccessContest({ inviteCode: "abc123", isManager: true, hasParticipation: false }),
    ).toBe(true);
  });

  it("private contests are visible to registered participants", () => {
    expect(
      canAccessContest({ inviteCode: "abc123", isManager: false, hasParticipation: true }),
    ).toBe(true);
  });
});
