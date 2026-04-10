import { describe, expect, it } from "vitest";

import {
  assessmentContextSchema,
  courseAssessmentCreateSchema,
  courseCreateSchema,
  courseJoinRequestSchema
} from "../../../packages/core/src/index";

describe("courseCreateSchema", () => {
  it("accepts teacher-authored course creation payloads", () => {
    const result = courseCreateSchema.parse({
      description: "Operating systems lab with graded programming assignments.",
      locale: "zh-TW",
      slug: "os-lab-spring-2026",
      title: "Operating Systems Lab"
    });

    expect(result.slug).toBe("os-lab-spring-2026");
    expect(result.locale).toBe("zh-TW");
  });
});

describe("courseJoinRequestSchema", () => {
  it("accepts link-based joins", () => {
    // Phase 1 redesign: join tokens are "link" or "code" — `qr_code` /
    // `manual_invite` are gone. QR codes are just a rendering of a
    // link-kind token.
    const result = courseJoinRequestSchema.parse({
      courseSlug: "os-lab-spring-2026",
      joinTokenKind: "link",
      joinToken: "oslab-qr-2026"
    });

    expect(result.joinTokenKind).toBe("link");
  });
});

describe("courseAssessmentCreateSchema", () => {
  it("rejects invalid assignment windows when dueAt is before opensAt", () => {
    const result = courseAssessmentCreateSchema.safeParse({
      closesAt: "2026-03-20T12:00:00.000Z",
      courseSlug: "os-lab-spring-2026",
      opensAt: "2026-03-18T12:00:00.000Z",
      problemIds: ["warmup-sum"],
      slug: "hw1-process-warmup",
      summary: "First assignment",
      title: "Homework 1",
      dueAt: "2026-03-17T12:00:00.000Z"
    });

    expect(result.success).toBe(false);
  });
});

describe("assessmentContextSchema", () => {
  it("parses assessment context with course and assessment slugs", () => {
    const result = assessmentContextSchema.parse({
      assessmentSlug: "hw1-process-warmup",
      courseSlug: "os-lab-spring-2026"
    });

    expect(result.assessmentSlug).toBe("hw1-process-warmup");
    expect(result.courseSlug).toBe("os-lab-spring-2026");
  });
});
