import { entryFileNameFor, mergeWorkspaceSources, type Language } from "@nojv/core";
import { expect, it } from "vitest";
import {
  buildSubmissionRequest,
  projectBrowserSubmission,
  type WorkspaceFile,
} from "$lib/components/features/problem/editors/editor-bindings";
import {
  buildSubmissionBody,
  submissionRequestValidationError,
} from "$lib/services/submission-service";

function file(
  language: Language,
  path: string,
  content: string,
  visibility: WorkspaceFile["visibility"],
): WorkspaceFile {
  return { language, path, content, visibility, description: "" };
}

it.each(["c", "cpp", "go", "java", "javascript", "python", "rust", "typescript"] as const)(
  "%s browser files preserve public helpers and match authoritative workspace overrides",
  (language) => {
    const entry = entryFileNameFor(language);
    const files = [
      file(language, entry, "starter", "editable"),
      file(language, "helper.txt", "readonly".repeat(75_000), "readonly"),
      file(language, "private.txt", "secret", "hidden"),
      file(language === "python" ? "cpp" : "python", "other.txt", "other language", "readonly"),
    ];
    const request = buildSubmissionRequest({
      context: { type: "practice" },
      language,
      problemId: "workspace",
      sampleOnly: true,
      isWorkspaceMode: true,
      workspaceFiles: files,
      workspaceDrafts: {
        [`${language}::${entry}`]: "user code",
        [`${language}::helper.txt`]: "tampered",
      },
      drafts: {},
    });
    expect(request.sourceFiles).toEqual([{ path: entry, content: "user code" }]);
    expect(submissionRequestValidationError(request)).toBeNull();
    expect(JSON.stringify(buildSubmissionBody(request))).not.toContain("readonly");
    const local = projectBrowserSubmission(request, files);
    expect(local.sourceFiles).toEqual([
      { path: entry, content: "user code" },
      { path: "helper.txt", content: files[1]!.content },
    ]);
    const server = mergeWorkspaceSources(
      request.sourceFiles!,
      files.filter((f) => f.language === language),
    );
    expect(server.filter((f) => f.path !== "private.txt")).toEqual(local.sourceFiles);
    expect(server.find((f) => f.path === "private.txt")?.content).toBe("secret");
    expect(JSON.stringify(local)).not.toContain("secret");
  },
);

it("includes public workspace dependencies for single-file browser Test", () => {
  const sourceCode = '#include "helper.h"\nint main(){return answer()!=42;}';
  const request = {
    context: { type: "practice" as const },
    language: "cpp" as const,
    problemId: "full",
    sourceCode,
  };
  const files = [
    file("cpp", "main.cpp", "starter", "editable"),
    file("cpp", "helper.h", "inline int answer(){return 42;}", "readonly"),
  ];
  expect(projectBrowserSubmission(request, files).sourceFiles).toEqual([
    { path: "main.cpp", content: sourceCode },
    { path: "helper.h", content: files[1]!.content },
  ]);
});

it("keeps readonly and hidden files authoritative and ignores unconfigured uploaded paths", () => {
  const files = [
    file("cpp", "main.cpp", "starter", "editable"),
    file("cpp", "helper.h", "trusted", "readonly"),
    file("cpp", "secret.h", "secret", "hidden"),
  ];
  const sources = [
    { path: "main.cpp", content: "solution" },
    { path: "helper.h", content: "tamper" },
    { path: "secret.h", content: "tamper" },
    { path: "extra.h", content: "extra" },
  ];
  expect(mergeWorkspaceSources(sources, files)).toEqual([
    { path: "main.cpp", content: "solution" },
    { path: "helper.h", content: "trusted" },
    { path: "secret.h", content: "secret" },
  ]);
});

it("validates the same source, testcase, and UTF-8 body limits before local execution", () => {
  const base = {
    context: { type: "practice" as const },
    language: "cpp" as const,
    problemId: "limits",
    sourceCode: "int main() {}",
    sampleOnly: true,
  };
  expect(submissionRequestValidationError(base)).toBeNull();
  expect(submissionRequestValidationError({ ...base, sourceCode: "x".repeat(50_001) })).toBe(
    "invalid_source",
  );
  expect(submissionRequestValidationError({ ...base, sourceCode: " \n" })).toBe(
    "invalid_source",
  );
  expect(
    submissionRequestValidationError({
      ...base,
      sourceFiles: [{ path: "main.cpp", content: "x".repeat(500_001) }],
    }),
  ).toBe("invalid_source");
  expect(
    submissionRequestValidationError({ ...base, runCases: [{ input: "x".repeat(200_001) }] }),
  ).toBe("invalid_run_cases");
  expect(
    submissionRequestValidationError({
      ...base,
      runCases: Array.from({ length: 11 }, () => ({ input: "" })),
    }),
  ).toBe("invalid_run_cases");
  expect(
    submissionRequestValidationError({
      ...base,
      runCases: Array.from({ length: 2 }, () => ({
        input: "字".repeat(200_000),
        expectedOutput: "字".repeat(200_000),
      })),
    }),
  ).toBe("request_too_large");
});
