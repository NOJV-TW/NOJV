import { describe, expect, it } from "vitest";

import {
  contestSessionSchema,
  pipelineConfigSchema,
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

  it("accepts multi-file submissions with entry file", () => {
    const result = submissionDraftSchema.parse({
      language: "typescript",
      mode: "practice",
      problemId: "multi-file-ts",
      sourceCode: "// fallback entry source",
      entryFile: "src/main.ts",
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

    expect(result.entryFile).toBe("src/main.ts");
    expect(result.sourceFiles).toHaveLength(2);
  });
});

describe("pipelineConfigSchema", () => {
  it("accepts custom-script stage configuration", () => {
    const result = pipelineConfigSchema.parse({
      stages: [
        { type: "compile" },
        {
          type: "custom-script",
          name: "project-policy",
          continueOnFail: false,
          config: {
            runAt: "before-compile",
            language: "python",
            timeoutMs: 5000,
            script: "print('ok')"
          }
        },
        { type: "execute" },
        { type: "check" }
      ]
    });

    expect(result.stages[1]?.type).toBe("custom-script");
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
  it("accepts weighted testcase sets with ordered stdin/stdout pairs", () => {
    const result = problemTestcaseSetCreateSchema.parse({
      cases: [
        {
          expectedStdout: "3\n",
          stdin: "1 2\n"
        },
        {
          expectedStdout: "300\n",
          stdin: "100 200\n"
        }
      ],
      isHidden: true,
      name: "Hidden Set",
      weight: 2
    });

    expect(result.cases).toHaveLength(2);
    expect(result.isHidden).toBe(true);
    expect(result.weight).toBe(2);
  });
});

describe("problemJudgeTestcaseSchema", () => {
  it("accepts persisted testcase metadata used by the judge runtime", () => {
    const result = problemJudgeTestcaseSchema.parse({
      expectedStdout: "3\n",
      id: "tc_01",
      isHidden: true,
      stdin: "1 2\n",
      weight: 3
    });

    expect(result.id).toBe("tc_01");
    expect(result.weight).toBe(3);
  });
});
