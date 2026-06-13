import { describe, expect, it, vi } from "vitest";

vi.mock("@nojv/db", () => ({
  problemRepo: {},
  problemStatementRepo: {},
  problemWorkspaceFileRepo: {},
  submissionRepo: {},
  testcaseSetRepo: {},
}));

import { LANGUAGE_TEMPLATES, supportedLanguages, type Language } from "@nojv/core";
import { problemDomain } from "@nojv/application";

const { buildStarterByLanguage } = problemDomain;

function residueWorkspaceFile(language: Language) {
  return {
    language,
    path: `main.${language}`,
    visibility: "editable",
    content: "// teacher-provided starter that must NOT leak into full_source",
  };
}

describe("buildStarterByLanguage — full_source", () => {
  it("returns the system LANGUAGE_TEMPLATES for every supported language", () => {
    const result = buildStarterByLanguage("full_source", []);
    for (const language of supportedLanguages) {
      expect(result[language]).toBe(LANGUAGE_TEMPLATES[language]);
    }
  });

  it("ignores workspace residue (defense-in-depth against pre-migration rows)", () => {
    const residue = supportedLanguages.map((lang) => residueWorkspaceFile(lang));
    const result = buildStarterByLanguage("full_source", residue);
    for (const language of supportedLanguages) {
      expect(result[language]).toBe(LANGUAGE_TEMPLATES[language]);
    }
  });

  it("returns a fresh copy — mutating the result does not mutate LANGUAGE_TEMPLATES", () => {
    const result = buildStarterByLanguage("full_source", []);
    result.python = "mutated";
    expect(LANGUAGE_TEMPLATES.python).not.toBe("mutated");
  });
});

describe("buildStarterByLanguage — multi_file", () => {
  it("overlays editable workspace files on top of LANGUAGE_TEMPLATES", () => {
    const pythonStarter = "def solve():\n    pass\n";
    const cppStarter = "// teacher cpp starter\n";
    const files = [
      { language: "python", path: "main.py", visibility: "editable", content: pythonStarter },
      { language: "cpp", path: "main.cpp", visibility: "editable", content: cppStarter },
    ];

    const result = buildStarterByLanguage("multi_file", files);

    expect(result.python).toBe(pythonStarter);
    expect(result.cpp).toBe(cppStarter);
    expect(result.java).toBe(LANGUAGE_TEMPLATES.java);
    expect(result.go).toBe(LANGUAGE_TEMPLATES.go);
  });

  it("falls back to LANGUAGE_TEMPLATES when no editable entry exists for the language", () => {
    const files = [
      { language: "python", path: "helper.py", visibility: "readonly", content: "helper" },
      { language: "python", path: "secret.py", visibility: "hidden", content: "" },
    ];

    const result = buildStarterByLanguage("multi_file", files);

    expect(result.python).toBe(LANGUAGE_TEMPLATES.python);
  });

  it("uses the first editable file when multiple are provided for the same language", () => {
    const files = [
      { language: "rust", path: "main.rs", visibility: "editable", content: "first" },
      { language: "rust", path: "extra.rs", visibility: "editable", content: "second" },
    ];

    const result = buildStarterByLanguage("multi_file", files);

    expect(result.rust).toBe("first");
  });
});

describe("buildStarterByLanguage — special_env", () => {
  it("returns the system LANGUAGE_TEMPLATES (no workspace overlay)", () => {
    const files = [
      {
        language: "python",
        path: "main.py",
        visibility: "editable",
        content: "should be ignored",
      },
    ];

    const result = buildStarterByLanguage("special_env", files);

    expect(result.python).toBe(LANGUAGE_TEMPLATES.python);
  });
});
