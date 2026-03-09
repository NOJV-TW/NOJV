import { describe, expect, it } from "vitest";

import {
  canCreateCourse,
  canCreateProblem,
  canManageCourseMembership,
  canPublishAssessment
} from "../src/lib/server/authorization/permissions";

describe("course authorization", () => {
  it("allows teachers to create courses", () => {
    expect(canCreateCourse("teacher")).toBe(true);
  });

  it("blocks students from creating courses", () => {
    expect(canCreateCourse("student")).toBe(false);
  });

  it("allows all authenticated users to create problems", () => {
    expect(canCreateProblem("teacher")).toBe(true);
    expect(canCreateProblem("admin")).toBe(true);
    expect(canCreateProblem("student")).toBe(true);
  });

  it("allows course staff to manage memberships", () => {
    expect(canManageCourseMembership("teacher")).toBe(true);
    expect(canManageCourseMembership("ta")).toBe(true);
    expect(canManageCourseMembership("admin")).toBe(true);
  });

  it("blocks students from publishing assessments", () => {
    expect(canPublishAssessment("student")).toBe(false);
  });
});
