import { describe, expect, it } from "vitest";

import { assessmentContextSchema, courseCreateSchema } from "../../../packages/core/src/index";

describe("courseCreateSchema", () => {
  it("accepts teacher-authored course creation payloads", () => {
    const result = courseCreateSchema.parse({
      description: "Operating systems lab with graded programming assignments.",
      title: "Operating Systems Lab",
    });

    expect(result.title).toBe("Operating Systems Lab");
  });
});

describe("assessmentContextSchema", () => {
  it("parses assessment context with courseId and assessmentId", () => {
    const result = assessmentContextSchema.parse({
      assessmentId: "hw1-process-warmup",
      courseId: "course_os-lab-spring-2026",
    });

    expect(result.assessmentId).toBe("hw1-process-warmup");
    expect(result.courseId).toBe("course_os-lab-spring-2026");
  });
});
