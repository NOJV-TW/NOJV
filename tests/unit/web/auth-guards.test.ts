import { ForbiddenError } from "@nojv/application";
import { describe, expect, it } from "vitest";

import { canCreateCourse, requirePlatformRole } from "$lib/server/auth";

import type { ActorContext } from "$lib/server/auth";

function makeActor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    displayName: "Test User",
    email: "test@example.com",
    username: "testuser",
    platformRole: "student",
    userId: "user-1",
    ...overrides,
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
