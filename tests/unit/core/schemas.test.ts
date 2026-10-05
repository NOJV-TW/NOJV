import { describe, expect, it } from "vitest";

import {
  contestSessionSchema,
  findPathConflict,
  MAX_INLINE_TESTCASE_EDIT_BYTES,
  MAX_TESTCASE_FILE_BYTES,
  parseIpWhitelistText,
  problemBasicInfoSchema,
  problemJudgeTestcaseSchema,
  problemTestcaseSetCreateSchema,
  MAX_SUBMISSION_SOURCE_FILE_CHARS,
  MAX_SUBMISSION_SOURCE_FILES,
  safeRelativePath,
  submissionDraftSchema,
  submissionJudgeDraftSchema,
  submissionResultSchema,
  testcaseSetUpdateSchema,
  testcaseUpdateSchema,
} from "../../../packages/core/src/index";

describe("problemBasicInfoSchema", () => {
  const basic = {
    difficulty: "medium",
    inputFormat: "",
    interactionFormat: "",
    outputFormat: "",
    statement: "",
    tags: [],
    title: "",
  } as const;

  it("keeps judge-owned fields out of a Basic info save", () => {
    const parsed = problemBasicInfoSchema.parse({
      ...basic,
      judgeConfig: { type: "checker", checkerLanguage: "python" },
      type: "multi_file",
      advancedRequiredPaths: ["main.py"],
    });

    expect(parsed).not.toHaveProperty("judgeConfig");
    expect(parsed).not.toHaveProperty("type");
    expect(parsed).not.toHaveProperty("advancedRequiredPaths");
  });

  it("leaves limits, visibility and admin consent unset unless sent", () => {
    const parsed = problemBasicInfoSchema.parse(basic);

    expect(parsed.timeLimitMs).toBeUndefined();
    expect(parsed.memoryLimitMb).toBeUndefined();
    expect(parsed.visibility).toBeUndefined();
    expect(parsed.adminMayPublish).toBeUndefined();
  });

  it.each([
    ["timeLimitMs", 50],
    ["memoryLimitMb", 0],
    ["interactionFormat", "x".repeat(8_001)],
  ] as const)("rejects an out-of-range %s", (field, value) => {
    expect(problemBasicInfoSchema.safeParse({ ...basic, [field]: value }).success).toBe(false);
  });
});

describe("testcaseSetUpdateSchema", () => {
  it("accepts a 0-point weight like set creation does", () => {
    expect(testcaseSetUpdateSchema.parse({ weight: 0 })).toEqual({ weight: 0 });
    expect(
      problemTestcaseSetCreateSchema.parse({ cases: [{ input: "", output: "" }], weight: 0 }),
    ).toMatchObject({ weight: 0 });
  });

  it("accepts 0-point sets in judge snapshots and judged results", () => {
    expect(
      problemJudgeTestcaseSchema.safeParse({ id: "tc", input: "1", output: "1", weight: 0 })
        .success,
    ).toBe(true);
    expect(
      submissionResultSchema.safeParse({
        accepted: true,
        feedback: "All testcases passed",
        runtimeMs: 1,
        score: 100,
        verdict: "accepted",
        subtaskResults: [
          {
            cases: [],
            label: "samples",
            passed: true,
            rawScore: 0,
            testcaseSetId: "s0",
            weight: 0,
          },
          {
            cases: [],
            label: "main",
            passed: true,
            rawScore: 100,
            testcaseSetId: "s1",
            weight: 100,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects a negative weight", () => {
    expect(testcaseSetUpdateSchema.safeParse({ weight: -1 }).success).toBe(false);
    expect(
      problemTestcaseSetCreateSchema.safeParse({
        cases: [{ input: "", output: "" }],
        weight: -1,
      }).success,
    ).toBe(false);
  });

  it("accepts a description-only update", () => {
    expect(testcaseSetUpdateSchema.parse({ description: "edge cases" })).toEqual({
      description: "edge cases",
    });
  });
});

describe("submissionDraftSchema", () => {
  it("preserves source whitespace while rejecting whitespace-only programs", () => {
    const draft = {
      context: { type: "practice" },
      language: "python",
      problemId: "source-preservation",
      sourceCode: "\n  print(42)\n",
    };
    expect(submissionDraftSchema.parse(draft).sourceCode).toBe(draft.sourceCode);
    expect(submissionDraftSchema.safeParse({ ...draft, sourceCode: " \n\t" }).success).toBe(
      false,
    );
  });

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

  it("rejects source files whose paths collide as file and directory", () => {
    const draft = {
      context: { type: "practice" as const },
      language: "python",
      problemId: "multi-file-py",
    };
    for (const paths of [
      ["lib", "lib/util.py"],
      ["lib/util.py", "lib"],
      ["main.py", "main.py"],
    ]) {
      expect(
        submissionDraftSchema.safeParse({
          ...draft,
          sourceFiles: paths.map((path) => ({ path, content: "x" })),
        }).success,
      ).toBe(false);
    }
    expect(
      submissionDraftSchema.safeParse({
        ...draft,
        sourceFiles: ["lib/a.py", "lib-b/a.py", "lib.py"].map((path) => ({
          path,
          content: "x",
        })),
      }).success,
    ).toBe(true);
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

  it("enforces the 10 MiB testcase file boundary by UTF-8 byte length", () => {
    const makeSet = (input: string) => ({
      cases: [{ input, output: "" }],
      name: "Large input",
      weight: 1,
    });

    expect(
      problemTestcaseSetCreateSchema.safeParse(makeSet("x".repeat(MAX_TESTCASE_FILE_BYTES)))
        .success,
    ).toBe(true);
    expect(
      problemTestcaseSetCreateSchema.safeParse(makeSet("x".repeat(MAX_TESTCASE_FILE_BYTES + 1)))
        .success,
    ).toBe(false);
    expect(
      problemTestcaseSetCreateSchema.safeParse(
        makeSet("界".repeat(Math.floor(MAX_TESTCASE_FILE_BYTES / 3))),
      ).success,
    ).toBe(true);
    expect(
      problemTestcaseSetCreateSchema.safeParse(
        makeSet("界".repeat(Math.floor(MAX_TESTCASE_FILE_BYTES / 3) + 1)),
      ).success,
    ).toBe(false);
  });

  it("caps inline testcase edits at 1 MiB, well below the 10 MiB upload limit", () => {
    expect(MAX_INLINE_TESTCASE_EDIT_BYTES).toBeLessThan(MAX_TESTCASE_FILE_BYTES);
    expect(
      testcaseUpdateSchema.safeParse({ input: "x".repeat(MAX_INLINE_TESTCASE_EDIT_BYTES) })
        .success,
    ).toBe(true);
    expect(
      testcaseUpdateSchema.safeParse({ input: "x".repeat(MAX_INLINE_TESTCASE_EDIT_BYTES + 1) })
        .success,
    ).toBe(false);
    expect(
      testcaseUpdateSchema.safeParse({ output: "x".repeat(MAX_INLINE_TESTCASE_EDIT_BYTES + 1) })
        .success,
    ).toBe(false);
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

  it("limits each segment to 255 UTF-8 bytes", () => {
    expect(safeRelativePath.parse(`src/${"a".repeat(255)}`)).toBe(`src/${"a".repeat(255)}`);
    expect(() => safeRelativePath.parse(`src/${"a".repeat(256)}`)).toThrow();
    expect(() => safeRelativePath.parse("é".repeat(128))).toThrow();
  });

  it("rejects a newline (would forge a MOSS boundary marker)", () => {
    expect(() => safeRelativePath.parse("main.py\n// === fake.py ===")).toThrow();
  });
});

describe("findPathConflict", () => {
  it("detects a file that is also used as a directory", () => {
    expect(findPathConflict(["src", "src/main.c"])).toEqual(["src", "src/main.c"]);
  });

  it("detects the conflict when a sibling sorts between the file and its child", () => {
    expect(findPathConflict(["src", "src.bak", "src/main.c"])).toEqual(["src", "src/main.c"]);
    expect(findPathConflict(["lib/x", "lib-extra", "lib"])).toEqual(["lib", "lib/x"]);
  });

  it("detects duplicate paths", () => {
    expect(findPathConflict(["a.py", "b.py", "a.py"])).toEqual(["a.py", "a.py"]);
  });

  it("accepts paths that only share a name prefix", () => {
    expect(findPathConflict(["src.bak", "src/main.c", "srcx"])).toBeNull();
  });
});
