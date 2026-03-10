import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProblemEditor } from "../src/components/problem-editor";

vi.mock("@monaco-editor/react", () => ({
  default: () => null
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) =>
    ({
      chars: "chars",
      code: "Code",
      contestMode: "contest",
      examMode: "exam",
      expectedOutput: "Expected Output",
      input: "Input",
      judgeFeedback: "Feedback",
      practiceMode: "practice",
      queueState: "Status",
      run: "Run",
      runFirst: "Run your code to see results.",
      submitButton: "Submit",
      submitting: "Submitting...",
      testcase: "Testcase",
      testResult: "Test Result",
      verdict: "Verdict"
    })[key] ?? key
}));

vi.mock("../src/components/telemetry-probe", () => ({
  TelemetryProbe: () => null
}));

describe("ProblemEditor", () => {
  it("renders the submit button and mode badge", () => {
    const markup = renderToStaticMarkup(
      <ProblemEditor
        problem={{
          acceptanceRate: 0.5,
          authorHandle: "teacher_amelia",
          difficulty: "easy",
          inputFormat: "",
          outputFormat: "",
          slug: "two-sum",
          samples: [],
          starterByLanguage: {
            c: "int main(void) { return 0; }",
            cpp: "int main() { return 0; }",
            java: "class Main { public static void main(String[] args) {} }",
            javascript: "console.log('hello');",
            python: "print('hello')",
            rust: "fn main() {}",
            typescript: "console.log('hello');"
          },
          statement: "Solve the problem.",
          summary: "Warm up.",
          tags: [],
          title: "Two Sum",
          totalSubmissions: 1,
          visibility: "public"
        }}
      />
    );

    expect(markup).toContain("Submit");
    expect(markup).toContain("practice");
  });
});
