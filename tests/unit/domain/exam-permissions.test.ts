import { describe, expect, it } from "vitest";

import { canManageExam } from "@nojv/domain";

// Exams are always course-embedded, so `canManageExam` checks
// ownership OR an active teacher/TA course membership.

const exam = { createdByUserId: "owner-1", courseId: "course-1" };

describe("canManageExam", () => {
  it("returns false for unauthenticated user", () => {
    expect(canManageExam(null, exam, [])).toBe(false);
  });

  it("returns true when user is the exam creator", () => {
    expect(canManageExam("owner-1", exam, [])).toBe(true);
  });

  it("returns true for an active teacher of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "teacher" as const, status: "active" as const }
    ];
    expect(canManageExam("teacher-1", exam, memberships)).toBe(true);
  });

  it("returns true for an active TA of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "ta" as const, status: "active" as const }
    ];
    expect(canManageExam("ta-1", exam, memberships)).toBe(true);
  });

  it("returns false for a student of the course", () => {
    const memberships = [
      { courseId: "course-1", role: "student" as const, status: "active" as const }
    ];
    expect(canManageExam("student-1", exam, memberships)).toBe(false);
  });

  it("returns false for a removed teacher membership", () => {
    const memberships = [
      { courseId: "course-1", role: "teacher" as const, status: "removed" as const }
    ];
    expect(canManageExam("teacher-1", exam, memberships)).toBe(false);
  });

  it("returns false when teacher membership is for a different course", () => {
    const memberships = [
      { courseId: "course-other", role: "teacher" as const, status: "active" as const }
    ];
    expect(canManageExam("teacher-1", exam, memberships)).toBe(false);
  });
});
