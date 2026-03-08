import { describe, expect, it } from "vitest";

import {
  deriveAssessmentPresentation,
  deriveAssessmentWindowState,
  resolveEffectiveCourseRole
} from "../src/lib/server/course-poc-helpers";

describe("resolveEffectiveCourseRole", () => {
  it("lets platform admins override course membership role", () => {
    expect(
      resolveEffectiveCourseRole({
        courseRole: "student",
        platformRole: "admin"
      })
    ).toBe("admin");
  });

  it("returns the course role for non-admin members", () => {
    expect(
      resolveEffectiveCourseRole({
        courseRole: "teacher",
        platformRole: "student"
      })
    ).toBe("teacher");
  });
});

describe("deriveAssessmentWindowState", () => {
  it("marks assignment windows as upcoming before opensAt", () => {
    expect(
      deriveAssessmentWindowState({
        closesAt: "2026-03-22T12:00:00.000Z",
        dueAt: "2026-03-20T12:00:00.000Z",
        now: "2026-03-18T11:59:00.000Z",
        opensAt: "2026-03-18T12:00:00.000Z"
      })
    ).toBe("upcoming");
  });
});

describe("deriveAssessmentPresentation", () => {
  it("uses live rank framing for exams", () => {
    expect(
      deriveAssessmentPresentation({
        scoreboardMode: "live",
        type: "exam"
      }).heroLabel
    ).toContain("Live rank");
  });

  it("uses deadline framing for assignments", () => {
    expect(
      deriveAssessmentPresentation({
        scoreboardMode: "hidden",
        type: "assignment"
      }).heroLabel
    ).toContain("Deadline");
  });
});
