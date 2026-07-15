import { describe, expect, it } from "vitest";

import {
  contestSessionSchema,
  parseIpWhitelistText,
  problemJudgeTestcaseSchema,
  problemTestcaseSetCreateSchema,
  MAX_SUBMISSION_SOURCE_FILE_CHARS,
  MAX_SUBMISSION_SOURCE_FILES,
  safeRelativePath,
  submissionDraftSchema,
  submissionJudgeDraftSchema,
  submissionResultSchema,
} from "../../../packages/core/src/index";

describe("submissionDraftSchema", () => {
  it("accepts practice submissions with explicit language and source", () => {
    const result = submissionDraftSchema.parse({
      context: { type: "practice" },
      language: "cpp",
      problemId: "two-sum-plus",
      sourceCode: "int main() { return 0; }",
    });

    expect(result.problemId).toBe("two-sum-plus");
  });

  it("accepts multi-file submissions", () => {
    const result = submissionDraftSchema.parse({
      context: { type: "practice" },
      language: "typescript",
      problemId: "multi-file-ts",
      sourceCode: "// fallback entry source",
      sourceFiles: [
        {
          path: "src/main.ts",
          content: "import { sum } from './sum.ts'; console.log(sum(1,2));",
        },
        {
          path: "src/sum.ts",
          content: "export const sum = (a:number,b:number)=>a+b;",
        },
      ],
    });

    expect(result.sourceFiles).toHaveLength(2);
    expect(result.sourceFiles?.[0]?.path).toBe("src/main.ts");
  });

  it("enforces the shared source-file size boundary", () => {
    const draft = {
      context: { type: "practice" as const },
      language: "typescript",
      problemId: "multi-file-ts",
      sourceFiles: [{ path: "main.ts", content: "x".repeat(MAX_SUBMISSION_SOURCE_FILE_CHARS) }],
    };

    expect(submissionDraftSchema.safeParse(draft).success).toBe(true);
    expect(
      submissionDraftSchema.safeParse({
        ...draft,
        sourceFiles: [
          { path: "main.ts", content: "x".repeat(MAX_SUBMISSION_SOURCE_FILE_CHARS + 1) },
        ],
      }).success,
    ).toBe(false);
  });

  it("enforces the shared source-file count boundary", () => {
    const file = (_: unknown, index: number) => ({
      path: `src/${String(index)}.ts`,
      content: "x",
    });
    const draft = {
      context: { type: "practice" as const },
      language: "typescript",
      problemId: "multi-file-ts",
    };

    expect(
      submissionDraftSchema.safeParse({
        ...draft,
        sourceFiles: Array.from({ length: MAX_SUBMISSION_SOURCE_FILES }, file),
      }).success,
    ).toBe(true);
    expect(
      submissionDraftSchema.safeParse({
        ...draft,
        sourceFiles: Array.from({ length: MAX_SUBMISSION_SOURCE_FILES + 1 }, file),
      }).success,
    ).toBe(false);
  });

  it("accepts runCases on sample-only runs", () => {
    const result = submissionDraftSchema.parse({
      context: { type: "practice" },
      language: "cpp",
      problemId: "sum-ab",
      runCases: [
        { input: "1 2\n", expectedOutput: "3\n" },
        { input: "10 20\n" }, // expectedOutput omitted — Run shows actual stdout only
      ],
      sampleOnly: true,
      sourceCode: "int main(){}",
    });

    expect(result.runCases).toHaveLength(2);
    expect(result.runCases?.[1]?.expectedOutput).toBeUndefined();
  });

  it("rejects runCases on graded submissions", () => {
    const parsed = submissionDraftSchema.safeParse({
      context: { type: "practice" },
      language: "cpp",
      problemId: "sum-ab",
      runCases: [{ input: "1\n", expectedOutput: "1\n" }],
      sampleOnly: false,
      sourceCode: "int main(){}",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects more than 10 runCases", () => {
    const parsed = submissionDraftSchema.safeParse({
      context: { type: "practice" },
      language: "cpp",
      problemId: "sum-ab",
      runCases: Array.from({ length: 11 }, () => ({ input: "x" })),
      sampleOnly: true,
      sourceCode: "int main(){}",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts all five explicit context variants and rejects legacy mixed IDs", () => {
    const common = {
      language: "cpp" as const,
      problemId: "sum-ab",
      sourceCode: "int main(){}",
    };
    const contexts = [
      { type: "practice" },
      { type: "assignment", assessmentId: "assignment-a", courseId: "course-a" },
      { type: "exam", examId: "exam-a" },
      { type: "contest", contestId: "contest-a" },
      { type: "virtual", participationId: "participation_a" },
    ];

    for (const context of contexts) {
      expect(submissionDraftSchema.safeParse({ ...common, context }).success).toBe(true);
    }
    expect(
      submissionDraftSchema.safeParse({
        ...common,
        context: { type: "practice" },
        contestId: "contest-a",
      }).success,
    ).toBe(false);
    expect(
      submissionDraftSchema.safeParse({
        ...common,
        context: {
          type: "assignment",
          assessmentId: "assignment-a",
          courseId: "course-a",
          examId: "exam-a",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps internal judge payloads context-free", () => {
    const internal = {
      language: "cpp" as const,
      problemId: "sum-ab",
      sampleOnly: false,
    };

    expect(submissionJudgeDraftSchema.safeParse(internal).success).toBe(true);
    expect(
      submissionJudgeDraftSchema.safeParse({
        ...internal,
        context: { type: "practice" },
      }).success,
    ).toBe(false);
  });
});

describe("contestSessionSchema", () => {
  it("requires a frozen scoreboard flag for contest sessions", () => {
    const result = contestSessionSchema.parse({
      contestId: "spring-qualifier-2026",
      endsAt: "2026-03-15T10:00:00.000Z",
      frozenScoreboard: true,
      startsAt: "2026-03-15T08:00:00.000Z",
    });

    expect(result.frozenScoreboard).toBe(true);
  });
});

describe("parseIpWhitelistText", () => {
  it("parses line-separated and CSV CIDR entries into a deduplicated list", () => {
    expect(
      parseIpWhitelistText(`
        10.0.0.0/8, 192.168.0.0/16
        2001:db8::/32;10.0.0.0/8
        203.0.113.4/32
      `),
    ).toEqual(["10.0.0.0/8", "192.168.0.0/16", "2001:db8::/32", "203.0.113.4/32"]);
  });

  it("drops empty cells from copied spreadsheets", () => {
    expect(parseIpWhitelistText(" 10.0.0.0/8,\t,\n\n192.168.1.0/24 ")).toEqual([
      "10.0.0.0/8",
      "192.168.1.0/24",
    ]);
  });
});

describe("problemTestcaseSetCreateSchema", () => {
  it("accepts weighted testcase sets with ordered input/output pairs", () => {
    const result = problemTestcaseSetCreateSchema.parse({
      cases: [
        {
          output: "3\n",
          input: "1 2\n",
        },
        {
          output: "300\n",
          input: "100 200\n",
        },
      ],
      name: "Hidden Set",
      weight: 2,
    });

    expect(result.cases).toHaveLength(2);
    expect(result.weight).toBe(2);
  });

  it("accepts subtask weights above the old 0-100 cap", () => {
    const parsed = problemTestcaseSetCreateSchema.safeParse({
      cases: [{ output: "3\n", input: "1 2\n" }],
      name: "Heavy Set",
      weight: 150,
    });

    expect(parsed.success).toBe(true);
  });
});

describe("submissionResultSchema", () => {
  it("accepts total scores above the old 0-100 cap", () => {
    const parsed = submissionResultSchema.safeParse({
      accepted: true,
      feedback: "All subtasks passed",
      runtimeMs: 12,
      score: 200,
      verdict: "accepted",
    });

    expect(parsed.success).toBe(true);
  });
});

describe("problemJudgeTestcaseSchema", () => {
  it("accepts persisted testcase metadata used by the judge runtime", () => {
    const result = problemJudgeTestcaseSchema.parse({
      output: "3\n",
      id: "tc_01",
      input: "1 2\n",
      weight: 3,
    });

    expect(result.id).toBe("tc_01");
    expect(result.weight).toBe(3);
  });
});

describe("safeRelativePath", () => {
  it("accepts a legit nested relative path", () => {
    expect(safeRelativePath.parse("src/lib/util.cpp")).toBe("src/lib/util.cpp");
  });

  it("rejects a leading slash (absolute path)", () => {
    expect(() => safeRelativePath.parse("/etc/passwd")).toThrow();
  });

  it("rejects a leading dot segment", () => {
    expect(() => safeRelativePath.parse("./main.py")).toThrow();
  });

  it("rejects a single dot segment", () => {
    expect(() => safeRelativePath.parse("src/./main.py")).toThrow();
  });

  it("rejects an empty segment", () => {
    expect(() => safeRelativePath.parse("src//main.py")).toThrow();
  });

  it("rejects leading or trailing whitespace instead of normalizing API input", () => {
    expect(() => safeRelativePath.parse(" main.py")).toThrow();
    expect(() => safeRelativePath.parse("main.py ")).toThrow();
  });

  it("rejects a parent traversal segment", () => {
    expect(() => safeRelativePath.parse("foo/../bar")).toThrow();
  });

  it("rejects a backslash (Windows separator)", () => {
    expect(() => safeRelativePath.parse(String.raw`win\path.cpp`)).toThrow();
  });

  it("rejects a NUL byte", () => {
    expect(() => safeRelativePath.parse("bad\0name")).toThrow();
  });

  it("rejects a colon", () => {
    expect(() => safeRelativePath.parse("C:/main.cpp")).toThrow();
    expect(() => safeRelativePath.parse("main:cpp")).toThrow();
  });

  it("rejects a newline (would forge a MOSS boundary marker)", () => {
    expect(() => safeRelativePath.parse("main.py\n// === fake.py ===")).toThrow();
  });
});
