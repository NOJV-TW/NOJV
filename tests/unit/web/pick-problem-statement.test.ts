import { describe, expect, it } from "vitest";

import { pickProblemStatement } from "@nojv/domain";

describe("pickProblemStatement", () => {
  it("returns localized statement when matching locale exists", () => {
    const statements = [
      { bodyMarkdown: "English body", locale: "en", title: "English Title" },
      { bodyMarkdown: "Chinese body", locale: "zh-TW", title: "Chinese Title" },
    ];

    const result = pickProblemStatement(statements, "zh-TW", "Fallback", "Fallback body");

    expect(result.title).toBe("Chinese Title");
    expect(result.statement).toBe("Chinese body");
  });

  it("falls back to first statement when locale doesn't match", () => {
    const statements = [
      { bodyMarkdown: "English body", locale: "en", title: "English Title" },
      { bodyMarkdown: "Chinese body", locale: "zh-TW", title: "Chinese Title" },
    ];

    const result = pickProblemStatement(statements, "ja", "Fallback", "Fallback body");

    expect(result.title).toBe("English Title");
    expect(result.statement).toBe("English body");
  });

  it("returns fallback title and statement when no statements provided", () => {
    const result = pickProblemStatement(undefined, "en", "Fallback Title", "Fallback body");

    expect(result.title).toBe("Fallback Title");
    expect(result.statement).toBe("Fallback body");
  });

  it("returns fallback when statements array is empty", () => {
    const result = pickProblemStatement([], "en", "Fallback Title", "Fallback body");

    expect(result.title).toBe("Fallback Title");
    expect(result.statement).toBe("Fallback body");
  });

  it("returns inputFormat and outputFormat from matched statement", () => {
    const statements = [
      {
        bodyMarkdown: "Body",
        inputFormat: "Two integers",
        locale: "en",
        outputFormat: "One integer",
        title: "Title",
      },
    ];

    const result = pickProblemStatement(statements, "en", "Fallback", "Fallback body");

    expect(result.inputFormat).toBe("Two integers");
    expect(result.outputFormat).toBe("One integer");
  });

  it("returns empty strings for inputFormat/outputFormat when not present in statement", () => {
    const statements = [{ bodyMarkdown: "Body", locale: "en", title: "Title" }];

    const result = pickProblemStatement(statements, "en", "Fallback", "Fallback body");

    expect(result.inputFormat).toBe("");
    expect(result.outputFormat).toBe("");
  });
});
