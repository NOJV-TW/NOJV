import { compareStandard, submissionDraftSchema } from "@nojv/core";
import { expect, it } from "vitest";
import { projectRunCasesForRequest } from "$lib/components/features/problem/editors/editor-bindings";
import { buildSubmissionBody } from "$lib/services/submission-service";

it("preserves explicit empty expected answers through browser and server request assembly", () => {
  const cases = projectRunCasesForRequest([
    { input: "empty-output sample", expectedOutput: "" },
    { input: "custom execution without comparison" },
    { input: "exact whitespace\r\n", expectedOutput: " \r\n" },
  ]);
  expect(cases).toEqual([
    { input: "empty-output sample", expectedOutput: "" },
    { input: "custom execution without comparison" },
    { input: "exact whitespace\r\n", expectedOutput: " \r\n" },
  ]);
  expect(compareStandard("WRONG", cases[0]!.expectedOutput!)).toBe(false);
  expect(compareStandard("", cases[0]!.expectedOutput!)).toBe(true);
  expect(cases[1]).not.toHaveProperty("expectedOutput");

  const body = submissionDraftSchema.parse(
    buildSubmissionBody({
      context: { type: "practice" },
      language: "cpp",
      problemId: "empty-output",
      sourceCode: "int main() {}",
      sampleOnly: true,
      runCases: cases,
    }),
  );
  expect(body.runCases).toEqual(cases);
});

it.each([
  { name: "empty", source: "" },
  { name: "larger than the single-file limit", source: "// helper\n".repeat(6000) },
])("accepts valid workspace files when the first file is $name", ({ source: sourceCode }) => {
  const sourceFiles = [
    { path: "helper.cpp", content: sourceCode },
    { path: "main.cpp", content: "int main() {}" },
  ];
  const body = buildSubmissionBody({
    context: { type: "practice" },
    language: "cpp",
    problemId: "workspace",
    sourceCode,
    sourceFiles,
  });
  expect(body).not.toHaveProperty("sourceCode");
  expect(submissionDraftSchema.parse(body).sourceFiles).toEqual(sourceFiles);
});
