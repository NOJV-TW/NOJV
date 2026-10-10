import { describe, expect, it } from "vitest";

import { interactiveContestantSupported, supportedLanguages, type Language } from "@nojv/core";

describe("interactiveContestantSupported", () => {
  const expected: Record<Language, boolean> = {
    c: true,
    cpp: true,
    go: true,
    java: true,
    javascript: false,
    python: true,
    rust: true,
    typescript: false,
  };

  it.each(supportedLanguages)("%s", (language) => {
    expect(interactiveContestantSupported(language)).toBe(expected[language]);
  });
});
