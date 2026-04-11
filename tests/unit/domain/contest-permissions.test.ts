import { describe, expect, it } from "vitest";

import { canManageContest } from "@nojv/domain";

const standalone = { createdByUserId: "owner-1", courseId: null };
const courseContest = { createdByUserId: "owner-1", courseId: "course-1" };

describe("canManageContest", () => {
  it("returns false for unauthenticated user", () => {
    expect(canManageContest(null, standalone, [])).toBe(false);
  });

  it("returns true when user is the contest creator", () => {
    expect(canManageContest("owner-1", standalone, [])).toBe(true);
  });

  it("returns false for a stranger on a standalone contest", () => {
    expect(canManageContest("stranger", standalone, [])).toBe(false);
  });

  it("returns true for an active teacher of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "teacher" as const, status: "active" as const }
    ];
    expect(canManageContest("teacher-1", courseContest, memberships)).toBe(true);
  });

  it("returns true for an active TA of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "ta" as const, status: "active" as const }
    ];
    expect(canManageContest("ta-1", courseContest, memberships)).toBe(true);
  });

  it("returns false for a student of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "student" as const, status: "active" as const }
    ];
    expect(canManageContest("student-1", courseContest, memberships)).toBe(false);
  });

  it("returns false for a removed teacher membership", () => {
    const memberships = [
      { courseId: "course-1", role: "teacher" as const, status: "removed" as const }
    ];
    expect(canManageContest("teacher-1", courseContest, memberships)).toBe(false);
  });

  it("returns false when teacher membership is for a different course", () => {
    const memberships = [
      { courseId: "course-other", role: "teacher" as const, status: "active" as const }
    ];
    expect(canManageContest("teacher-1", courseContest, memberships)).toBe(false);
  });

  it("returns false when standalone contest has no course to teach", () => {
    const memberships = [
      { courseId: "course-1", role: "teacher" as const, status: "active" as const }
    ];
    expect(canManageContest("teacher-1", standalone, memberships)).toBe(false);
  });
});
