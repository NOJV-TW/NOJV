import { describe, expect, it } from "vitest";

import {
  canCreateCourse,
  canManageCourseMembership,
  canPublishAssessment,
  canViewManagePanel,
  ForbiddenError,
  isCourseStaff,
  requirePlatformRole,
  resolveCoursePermissionRole
} from "$lib/server/auth";

import type { ActorContext } from "$lib/server/auth";

function makeActor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    displayName: "Test User",
    email: "test@example.com",
    username: "testuser",
    platformRole: "student",
    userId: "user-1",
    ...overrides
  };
}

describe("requirePlatformRole", () => {
  it("passes when actor has the allowed role", () => {
    const actor = makeActor({ platformRole: "admin" });
    expect(() => requirePlatformRole(actor, "admin")).not.toThrow();
  });

  it("throws ForbiddenError when actor role is not allowed", () => {
    const actor = makeActor({ platformRole: "student" });
    expect(() => requirePlatformRole(actor, "admin")).toThrow(ForbiddenError);
  });

  it("passes with multiple allowed roles", () => {
    const actor = makeActor({ platformRole: "teacher" });
    expect(() => requirePlatformRole(actor, "admin", "teacher")).not.toThrow();
  });

  it("throws for student when only admin and teacher are allowed", () => {
    const actor = makeActor({ platformRole: "student" });
    expect(() => requirePlatformRole(actor, "admin", "teacher")).toThrow(ForbiddenError);
  });
});

describe("resolveCoursePermissionRole", () => {
  it('returns "admin" when platformRole is admin regardless of courseRole', () => {
    expect(resolveCoursePermissionRole({ platformRole: "admin", courseRole: "student" })).toBe(
      "admin"
    );
    expect(resolveCoursePermissionRole({ platformRole: "admin", courseRole: null })).toBe(
      "admin"
    );
  });

  it("returns courseRole when platformRole is not admin and courseRole exists", () => {
    expect(
      resolveCoursePermissionRole({ platformRole: "teacher", courseRole: "teacher" })
    ).toBe("teacher");
    expect(resolveCoursePermissionRole({ platformRole: "student", courseRole: "ta" })).toBe(
      "ta"
    );
  });

  it("returns null when platformRole is not admin and courseRole is null", () => {
    expect(
      resolveCoursePermissionRole({ platformRole: "student", courseRole: null })
    ).toBeNull();
  });

  it("returns null when platformRole is not admin and courseRole is undefined", () => {
    expect(resolveCoursePermissionRole({ platformRole: "student" })).toBeNull();
  });
});

describe("canCreateCourse", () => {
  it("returns true for admin", () => {
    expect(canCreateCourse("admin")).toBe(true);
  });

  it("returns true for teacher", () => {
    expect(canCreateCourse("teacher")).toBe(true);
  });

  it("returns false for student", () => {
    expect(canCreateCourse("student")).toBe(false);
  });
});

describe("isCourseStaff", () => {
  it("returns true for admin", () => {
    expect(isCourseStaff("admin")).toBe(true);
  });

  it("returns true for teacher", () => {
    expect(isCourseStaff("teacher")).toBe(true);
  });

  it("returns true for ta", () => {
    expect(isCourseStaff("ta")).toBe(true);
  });

  it("returns false for student", () => {
    expect(isCourseStaff("student")).toBe(false);
  });
});

describe("permission aliases", () => {
  it("canManageCourseMembership is isCourseStaff", () => {
    expect(canManageCourseMembership).toBe(isCourseStaff);
  });

  it("canPublishAssessment is isCourseStaff", () => {
    expect(canPublishAssessment).toBe(isCourseStaff);
  });

  it("canViewManagePanel is isCourseStaff", () => {
    expect(canViewManagePanel).toBe(isCourseStaff);
  });
});
