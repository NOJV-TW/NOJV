import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProblemEditor } from "../src/components/problem-editor";

vi.mock("@monaco-editor/react", () => ({
  default: () => null,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    () =>
    (key: string) =>
      ({
        chars: "chars",
        contestMode: "Contest mode",
        examMode: "Exam mode",
        executionGuarantees: "Execution guarantees",
        executionHint1: "Hint 1",
        executionHint2: "Hint 2",
        judgeFeedback: "Judge feedback",
        language: "Language",
        onlineEditor: "Online editor",
        onlineEditorSubtitle: "Write and submit solutions.",
        practiceMode: "Practice mode",
        queueState: "Queue state",
        sandboxJudge: "Sandbox judge",
        submitButton: "Submit to sandbox judge",
        submitHint: "Hint",
        submitting: "Submitting...",
        submissionVerdict: "Submission verdict",
        verdict: "Verdict",
      })[key] ?? key,
}));

vi.mock("../src/components/telemetry-probe", () => ({
  TelemetryProbe: () => null,
}));

describe("ProblemEditor", () => {
  it("keeps the submission action but removes the retired workspace launch CTA", () => {
    const markup = renderToStaticMarkup(
      <ProblemEditor
        problem={{
          acceptanceRate: 0.5,
          authorHandle: "teacher_amelia",
          difficulty: "easy",
          slug: "two-sum",
          samples: [],
          starterByLanguage: {
            c: "int main(void) { return 0; }",
            cpp: "int main() { return 0; }",
            java: "class Main { public static void main(String[] args) {} }",
            javascript: "console.log('hello');",
            python: "print('hello')",
            rust: "fn main() {}",
            typescript: "console.log('hello');",
          },
          statement: "Solve the problem.",
          summary: "Warm up.",
          tags: [],
          title: "Two Sum",
          totalSubmissions: 1,
          visibility: "public",
        }}
      />,
    );

    expect(markup).toContain("Submit to sandbox judge");
    expect(markup).not.toContain("href=\"http://localhost:4173/\"");
  });
});
