import { describe, expect, it } from "vitest";

import {
  assessmentContextSchema,
  courseAssessmentCreateSchema,
  courseCreateSchema
} from "../../../packages/core/src/index";

describe("courseCreateSchema", () => {
  it("accepts teacher-authored course creation payloads", () => {
    const result = courseCreateSchema.parse({
      description: "Operating systems lab with graded programming assignments.",
      title: "Operating Systems Lab"
    });

    expect(result.title).toBe("Operating Systems Lab");
  });
});

describe("courseAssessmentCreateSchema", () => {
  it("rejects invalid assignment windows when dueAt is before opensAt", () => {
    const result = courseAssessmentCreateSchema.safeParse({
      closesAt: "2026-03-20T12:00:00.000Z",
      courseId: "course_os-lab-spring-2026",
      opensAt: "2026-03-18T12:00:00.000Z",
      problemIds: ["warmup-sum"],
      slug: "hw1-process-warmup",
      summary: "First assignment",
      title: "Homework 1",
      dueAt: "2026-03-17T12:00:00.000Z"
    });

    expect(result.success).toBe(false);
  });

  it("accepts problemIds containing underscores (actual DB ids like problem_warmup-sum)", () => {
    const result = courseAssessmentCreateSchema.safeParse({
      closesAt: "2026-03-30T12:00:00.000Z",
      courseId: "course_os-lab-spring-2026",
      opensAt: "2026-03-18T12:00:00.000Z",
      dueAt: "2026-03-25T12:00:00.000Z",
      problemIds: ["problem_warmup-sum", "problem_add-two-numbers"],
      slug: "hw1-process-warmup",
      summary: "Process warmup with two easy problems.",
      title: "HW1 Process Warmup"
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty problemIds array", () => {
    const result = courseAssessmentCreateSchema.safeParse({
      closesAt: "2026-03-30T12:00:00.000Z",
      courseId: "course_os-lab-spring-2026",
      opensAt: "2026-03-18T12:00:00.000Z",
      problemIds: [],
      slug: "hw1-process-warmup",
      summary: "Process warmup with two easy problems.",
      title: "HW1 Process Warmup"
    });

    expect(result.success).toBe(false);
  });

  it("rejects problemIds whose entries are empty strings", () => {
    const result = courseAssessmentCreateSchema.safeParse({
      closesAt: "2026-03-30T12:00:00.000Z",
      courseId: "course_os-lab-spring-2026",
      opensAt: "2026-03-18T12:00:00.000Z",
      problemIds: [""],
      slug: "hw1-process-warmup",
      summary: "Process warmup with two easy problems.",
      title: "HW1 Process Warmup"
    });

    expect(result.success).toBe(false);
  });
});

describe("assessmentContextSchema", () => {
  it("parses assessment context with courseId and assessment slug", () => {
    const result = assessmentContextSchema.parse({
      assessmentSlug: "hw1-process-warmup",
      courseId: "course_os-lab-spring-2026"
    });

    expect(result.assessmentSlug).toBe("hw1-process-warmup");
    expect(result.courseId).toBe("course_os-lab-spring-2026");
  });
});
