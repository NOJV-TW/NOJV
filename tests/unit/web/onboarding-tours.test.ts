import { describe, expect, it } from "vitest";
import { studentIntros } from "$lib/onboarding/student-tour";
import { taIntros, teacherIntros } from "$lib/onboarding/teacher-tour";

describe("tour registries", () => {
  it("teacher intro keys are prefixed and disjoint from student keys", () => {
    const studentKeys = new Set(studentIntros.map((i) => i.key));
    for (const intro of teacherIntros) {
      expect(intro.key).toMatch(/^teacher-/);
      expect(studentKeys.has(intro.key)).toBe(false);
    }
  });

  it("routes teacher pages to the right intro", () => {
    const at = (p: string) => teacherIntros.filter((i) => i.match(p)).map((i) => i.key);
    expect(at("/dashboard")).toEqual(["teacher-nav", "teacher-welcome-guide"]);
    expect(at("/courses")).toEqual(["teacher-courses"]);
    expect(at("/courses/abc123/members")).toEqual(["teacher-members"]);
    expect(at("/problems")).toEqual(["teacher-problems"]);
    expect(at("/problems/abc123")).toEqual([]);
    expect(at("/problems/abc123/edit")).toEqual(["teacher-problem-edit"]);
    expect(at("/courses/abc123/assignments/new")).toEqual(["teacher-assignment-new"]);
    expect(at("/assignments/xyz")).toEqual(["teacher-monitor"]);
    expect(at("/courses/abc123/grades")).toEqual(["teacher-gradebook"]);
  });

  it("TA registry contains only management intros", () => {
    expect(taIntros.map((i) => i.key)).toEqual([
      "teacher-members",
      "teacher-problem-edit",
      "teacher-assignment-new",
      "teacher-monitor",
      "teacher-gradebook",
    ]);
  });
});
