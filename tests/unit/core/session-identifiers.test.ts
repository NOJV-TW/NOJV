import { describe, expect, it } from "vitest";

interface EditorSessionIdentifierInput {
  assessmentSlug?: string | undefined;
  contestSlug?: string | undefined;
  courseId?: string | undefined;
  problemId: string;
}

function sanitizeSessionSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "unknown";
}

function joinSessionSegments(prefix: string, segments: string[]) {
  const joined = [prefix, ...segments.map(sanitizeSessionSegment)].join("_");

  return joined.length <= 128 ? joined : joined.slice(0, 128);
}

function buildEditorSessionId(input: EditorSessionIdentifierInput) {
  if (input.contestSlug) {
    return joinSessionSegments("editor", [input.problemId, "contest", input.contestSlug]);
  }

  if (input.courseId && input.assessmentSlug) {
    return joinSessionSegments("editor", [
      input.problemId,
      input.courseId,
      input.assessmentSlug
    ]);
  }

  return joinSessionSegments("editor", [input.problemId, "practice"]);
}

describe("buildEditorSessionId", () => {
  it("keeps contest telemetry distinct from practice telemetry for the same problem", () => {
    expect(
      buildEditorSessionId({
        contestSlug: "spring-qualifier-2026",
        problemId: "warmup-sum"
      })
    ).toBe("editor_warmup-sum_contest_spring-qualifier-2026");
  });

  it("includes course assessment context for assignment editors", () => {
    expect(
      buildEditorSessionId({
        assessmentSlug: "hw1-process-trace",
        courseId: "course_os-lab-spring-2026",
        problemId: "process-log-parser"
      })
    ).toBe("editor_process-log-parser_course-os-lab-spring-2026_hw1-process-trace");
  });
});
