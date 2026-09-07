import { describe, expect, it } from "vitest";

import {
  examSubTabHref,
  parseExamSubTab,
} from "$lib/components/features/course/exam/exam-tab-state";

describe("exam tab state", () => {
  it("restores a valid tab from the URL and defaults unknown values to problems", () => {
    expect(parseExamSubTab("results")).toBe("results");
    expect(parseExamSubTab("unknown")).toBe("problems");
    expect(parseExamSubTab(null)).toBe("problems");
  });

  it("writes the selected tab without dropping other query parameters", () => {
    const currentUrl = new URL("https://nojv.test/exams/exam_1?tab=problems&view=compact");

    expect(examSubTabHref(currentUrl, "submissions")).toBe(
      "/exams/exam_1?tab=submissions&view=compact",
    );
    expect(examSubTabHref(currentUrl, "problems")).toBe("/exams/exam_1?view=compact");
  });
});
