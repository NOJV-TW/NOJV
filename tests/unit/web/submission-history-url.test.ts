import { describe, expect, it } from "vitest";

import {
  parseSubmissionHistoryFilters,
  sanitizeSubmissionHistoryReturnTo,
  submissionHistoryReturnTo,
} from "$lib/utils/submission-history";

describe("submission history URL state", () => {
  it("ignores malformed return URLs without failing the detail page", () => {
    expect(sanitizeSubmissionHistoryReturnTo("/\\[", "/exams/exam_1")).toBeNull();
  });

  it("round-trips filters without dropping the current assessment tab", () => {
    const current = new URL("http://localhost/exams/exam_1?tab=submissions");
    const filters = parseSubmissionHistoryFilters(
      new URLSearchParams(
        "tab=submissions&userSearch=student01&ipSearch=203.0.113.10&filterProblemId=problem_a&language=cpp&status=wrong_answer&sort=score&order=asc",
      ),
    );

    expect(submissionHistoryReturnTo(current, filters)).toBe(
      "/exams/exam_1?tab=submissions&userSearch=student01&ipSearch=203.0.113.10&filterProblemId=problem_a&language=cpp&status=wrong_answer&sort=score&order=asc",
    );
  });

  it("rejects external or unrelated return paths", () => {
    expect(
      sanitizeSubmissionHistoryReturnTo("https://evil.example/", "/exams/exam_1"),
    ).toBeNull();
    expect(sanitizeSubmissionHistoryReturnTo("//evil.example/", "/exams/exam_1")).toBeNull();
    expect(
      sanitizeSubmissionHistoryReturnTo("/assignments/assignment_1", "/exams/exam_1"),
    ).toBeNull();
    expect(
      sanitizeSubmissionHistoryReturnTo(
        "/exams/exam_1?tab=submissions&status=accepted",
        "/exams/exam_1",
      ),
    ).toBe("/exams/exam_1?tab=submissions&status=accepted");
    expect(
      sanitizeSubmissionHistoryReturnTo(
        "/zh-TW/exams/exam_1?tab=submissions&status=accepted",
        "/exams/exam_1",
      ),
    ).toBe("/zh-TW/exams/exam_1?tab=submissions&status=accepted");
    expect(
      sanitizeSubmissionHistoryReturnTo(
        "/zh-TW/assignments/assignment_1?userSearch=student01",
        "/assignments/assignment_1",
      ),
    ).toBe("/zh-TW/assignments/assignment_1?userSearch=student01");
  });
});
