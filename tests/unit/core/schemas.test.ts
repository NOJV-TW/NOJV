import { describe, expect, it } from "vitest";

import {
  contestSessionSchema,
  problemJudgeTestcaseSchema,
  problemTestcaseSetCreateSchema,
  submissionDraftSchema
} from "../../../packages/core/src/index";

describe("submissionDraftSchema", () => {
  it("accepts practice submissions with explicit language and source", () => {
    const result = submissionDraftSchema.parse({
      language: "cpp",
      mode: "practice",
      problemId: "two-sum-plus",
      sourceCode: "int main() { return 0; }"
    });

    expect(result.problemId).toBe("two-sum-plus");
  });

  it("accepts multi-file submissions", () => {
    const result = submissionDraftSchema.parse({
      language: "typescript",
      mode: "practice",
      problemId: "multi-file-ts",
      sourceCode: "// fallback entry source",
      sourceFiles: [
        {
          path: "src/main.ts",
          content: "import { sum } from './sum.ts'; console.log(sum(1,2));"
        },
        {
          path: "src/sum.ts",
          content: "export const sum = (a:number,b:number)=>a+b;"
        }
      ]
    });

    expect(result.sourceFiles).toHaveLength(2);
    expect(result.sourceFiles?.[0]?.path).toBe("src/main.ts");
  });

  it("accepts customTestcases on sample-only runs", () => {
    const result = submissionDraftSchema.parse({
      customTestcases: [
        { input: "1 2\n", expectedOutput: "3\n" },
        { input: "10 20\n" } // expectedOutput omitted — Run shows actual stdout only
      ],
      language: "cpp",
      mode: "practice",
      problemId: "sum-ab",
      sampleOnly: true,
      sourceCode: "int main(){}"
    });

    expect(result.customTestcases).toHaveLength(2);
    expect(result.customTestcases?.[1]?.expectedOutput).toBeUndefined();
  });

  it("rejects customTestcases on graded submissions", () => {
    const parsed = submissionDraftSchema.safeParse({
      customTestcases: [{ input: "1\n", expectedOutput: "1\n" }],
      language: "cpp",
      mode: "practice",
      problemId: "sum-ab",
      sampleOnly: false,
      sourceCode: "int main(){}"
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects more than 10 customTestcases", () => {
    const parsed = submissionDraftSchema.safeParse({
      customTestcases: Array.from({ length: 11 }, () => ({ input: "x" })),
      language: "cpp",
      problemId: "sum-ab",
      sampleOnly: true,
      sourceCode: "int main(){}"
    });

    expect(parsed.success).toBe(false);
  });
});

describe("contestSessionSchema", () => {
  it("requires a frozen scoreboard flag for contest sessions", () => {
    const result = contestSessionSchema.parse({
      contestSlug: "spring-qualifier-2026",
      endsAt: "2026-03-15T10:00:00.000Z",
      frozenScoreboard: true,
      startsAt: "2026-03-15T08:00:00.000Z"
    });

    expect(result.frozenScoreboard).toBe(true);
  });
});

describe("problemTestcaseSetCreateSchema", () => {
  it("accepts weighted testcase sets with ordered input/output pairs", () => {
    const result = problemTestcaseSetCreateSchema.parse({
      cases: [
        {
          output: "3\n",
          input: "1 2\n"
        },
        {
          output: "300\n",
          input: "100 200\n"
        }
      ],
      name: "Hidden Set",
      weight: 2
    });

    expect(result.cases).toHaveLength(2);
    expect(result.weight).toBe(2);
  });
});

describe("problemJudgeTestcaseSchema", () => {
  it("accepts persisted testcase metadata used by the judge runtime", () => {
    const result = problemJudgeTestcaseSchema.parse({
      output: "3\n",
      id: "tc_01",
      input: "1 2\n",
      weight: 3
    });

    expect(result.id).toBe("tc_01");
    expect(result.weight).toBe(3);
  });
});
