import type { Language } from "@nojv/core";
import type { submissionDomain } from "@nojv/domain";
import type { SubmissionSource } from "@nojv/storage";
import { describe, expect, it } from "vitest";

import { mergeSandboxSources } from "../../../apps/worker/src/activities/judge";

type WorkspaceFile = submissionDomain.SubmissionJudgeContext["workspaceFiles"][number];

function makeJudgeContext(
  workspaceFiles: WorkspaceFile[],
): submissionDomain.SubmissionJudgeContext {
  return {
    adjustment: {
      assignmentAdjustmentRules: null,
      dueAt: null,
      finalDay: null,
      submittedAt: new Date(0),
    },
    checkerScript: null,
    interactorScript: null,
    judgeType: "standard",
    runtime: "docker",
    samples: [],
    problemType: "full_source",
    subtaskStrategies: {},
    testcaseSets: [],
    workspaceFiles,
    advanced: null,
  };
}

describe("mergeSandboxSources", () => {
  it("passes a single student source through unchanged for full_source problems", () => {
    const studentSources: SubmissionSource[] = [{ path: "main.py", content: "print('hi')" }];
    const ctx = makeJudgeContext([]);

    const result = mergeSandboxSources(studentSources, "python" satisfies Language, ctx);

    expect(result.sourceCode).toBe("print('hi')");
    expect(result.sourceFiles).toBeUndefined();
    expect(result.entryFile).toBeUndefined();
  });

  it("returns all student files (multi-file student, no workspace) and main as sourceCode", () => {
    const studentSources: SubmissionSource[] = [
      { path: "main.py", content: "print('hi')" },
      { path: "extra.py", content: "x = 1" },
    ];
    const ctx = makeJudgeContext([]);

    const result = mergeSandboxSources(studentSources, "python" satisfies Language, ctx);

    expect(result.sourceCode).toBe("print('hi')");
    expect(result.sourceFiles).toEqual([
      { path: "main.py", content: "print('hi')" },
      { path: "extra.py", content: "x = 1" },
    ]);
  });

  it("drops student-supplied files that are not in the editable workspace allowlist", () => {
    const workspaceFiles: WorkspaceFile[] = [
      {
        path: "main.py",
        content: "# teacher main",
        language: "python",
        visibility: "editable",
      },
      {
        path: "secret.py",
        content: "TEACHER_SECRET = 42",
        language: "python",
        visibility: "readonly",
      },
    ];
    const studentSources: SubmissionSource[] = [
      { path: "main.py", content: "print('student main')" },
      { path: "secret.py", content: "TEACHER_SECRET = 0" },
    ];
    const ctx = makeJudgeContext(workspaceFiles);

    const result = mergeSandboxSources(studentSources, "python" satisfies Language, ctx);

    expect(result.entryFile).toBe("main.py");
    expect(result.sourceCode).toBe("print('student main')");
    const byPath = new Map(result.sourceFiles!.map((f) => [f.path, f.content]));
    expect(byPath.get("main.py")).toBe("print('student main')");
    expect(byPath.get("secret.py")).toBe("TEACHER_SECRET = 42");
  });

  it("falls back to teacher's main content when student is missing main.<ext>", () => {
    const workspaceFiles: WorkspaceFile[] = [
      {
        path: "main.py",
        content: "# teacher main",
        language: "python",
        visibility: "editable",
      },
      {
        path: "helper.py",
        content: "# teacher helper",
        language: "python",
        visibility: "editable",
      },
    ];
    const studentSources: SubmissionSource[] = [
      { path: "helper.py", content: "def help(): pass" },
    ];
    const ctx = makeJudgeContext(workspaceFiles);

    const result = mergeSandboxSources(studentSources, "python" satisfies Language, ctx);

    expect(result.entryFile).toBe("main.py");
    expect(result.sourceCode).toBe("# teacher main");
    const byPath = new Map(result.sourceFiles!.map((f) => [f.path, f.content]));
    expect(byPath.get("main.py")).toBe("# teacher main");
    expect(byPath.get("helper.py")).toBe("def help(): pass");
  });

  it("merges all editable student files while keeping non-editable teacher files intact", () => {
    const workspaceFiles: WorkspaceFile[] = [
      {
        path: "main.py",
        content: "# teacher main",
        language: "python",
        visibility: "editable",
      },
      { path: "lib.py", content: "# teacher lib", language: "python", visibility: "editable" },
      {
        path: "hidden.py",
        content: "# teacher hidden",
        language: "python",
        visibility: "hidden",
      },
      {
        path: "readme.py",
        content: "# teacher readme",
        language: "python",
        visibility: "readonly",
      },
    ];
    const studentSources: SubmissionSource[] = [
      { path: "main.py", content: "print('main')" },
      { path: "lib.py", content: "print('lib')" },
      { path: "hidden.py", content: "print('hidden')" },
      { path: "readme.py", content: "print('readme')" },
    ];
    const ctx = makeJudgeContext(workspaceFiles);

    const result = mergeSandboxSources(studentSources, "python" satisfies Language, ctx);

    expect(result.entryFile).toBe("main.py");
    expect(result.sourceCode).toBe("print('main')");
    const byPath = new Map(result.sourceFiles!.map((f) => [f.path, f.content]));
    expect(byPath.get("main.py")).toBe("print('main')");
    expect(byPath.get("lib.py")).toBe("print('lib')");
    expect(byPath.get("hidden.py")).toBe("# teacher hidden");
    expect(byPath.get("readme.py")).toBe("# teacher readme");
    expect(
      result.sourceFiles!.map((f) => f.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual(["hidden.py", "lib.py", "main.py", "readme.py"]);
  });

  it("ignores workspace files for a different language", () => {
    const workspaceFiles: WorkspaceFile[] = [
      {
        path: "Main.java",
        content: "// teacher java",
        language: "java",
        visibility: "editable",
      },
    ];
    const studentSources: SubmissionSource[] = [{ path: "main.py", content: "print('py')" }];
    const ctx = makeJudgeContext(workspaceFiles);

    const result = mergeSandboxSources(studentSources, "python" satisfies Language, ctx);

    expect(result.sourceCode).toBe("print('py')");
    expect(result.sourceFiles).toBeUndefined();
    expect(result.entryFile).toBeUndefined();
  });
});
