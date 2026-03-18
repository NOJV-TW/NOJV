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
      problemSlug: "two-sum-plus",
      sourceCode: "int main() { return 0; }"
    });

    expect(result.problemSlug).toBe("two-sum-plus");
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
