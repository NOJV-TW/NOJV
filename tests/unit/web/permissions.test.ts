import { describe, expect, it } from "vitest";

import { canEditProblem, canManageCourse, resolveEffectiveCourseRole } from "@nojv/domain";

describe("resolveEffectiveCourseRole", () => {
  it("admin platform role overrides course role", () => {
    expect(resolveEffectiveCourseRole("admin", "student")).toBe("admin");
  });

  it("admin platform role returns admin even with null course role", () => {
    expect(resolveEffectiveCourseRole("admin", null)).toBe("admin");
  });

  it("returns course role when platform role is student", () => {
    expect(resolveEffectiveCourseRole("student", "ta")).toBe("ta");
  });

  it("returns course role when platform role is teacher", () => {
    expect(resolveEffectiveCourseRole("teacher", "teacher")).toBe("teacher");
  });

  it("returns null when no course membership", () => {
    expect(resolveEffectiveCourseRole("student", null)).toBeNull();
  });

  it("returns null when teacher has no course membership", () => {
    expect(resolveEffectiveCourseRole("teacher", null)).toBeNull();
  });
});

describe("canManageCourse", () => {
  it("admin can manage", () => expect(canManageCourse("admin")).toBe(true));
  it("teacher can manage", () => expect(canManageCourse("teacher")).toBe(true));
  it("ta can manage", () => expect(canManageCourse("ta")).toBe(true));
  it("student cannot manage", () => expect(canManageCourse("student")).toBe(false));
  it("null role cannot manage", () => expect(canManageCourse(null)).toBe(false));
});

describe("canEditProblem", () => {
  it("admin can edit", () => expect(canEditProblem("admin")).toBe(true));
  it("teacher can edit", () => expect(canEditProblem("teacher")).toBe(true));
  it("student cannot edit", () => expect(canEditProblem("student")).toBe(false));
});
