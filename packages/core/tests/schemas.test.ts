import { describe, expect, it } from "vitest";

import {
  cheatingSignalSchema,
  contestSessionSchema,
  problemJudgeTestcaseSchema,
  problemTestcaseSetCreateSchema,
  submissionDraftSchema,
  workspaceRunRequestSchema
} from "../src/index";

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

describe("workspaceRunRequestSchema", () => {
  it("accepts isolated runs with an explicit file payload", () => {
    const result = workspaceRunRequestSchema.parse({
      command: "make run",
      files: [
        {
          content: "run:\n\t@cat src/message.txt\n",
          path: "Makefile"
        },
        {
          content: "hello\n",
          path: "src/message.txt"
        }
      ],
      mode: "assignment",
      timeoutMs: 4_000,
      workspaceSessionId: "ws_assignment_demo_01"
    });

    expect(result.files).toHaveLength(2);
    expect(result.timeoutMs).toBe(4_000);
  });

  it("rejects command batches without a workspace session id", () => {
    const result = workspaceRunRequestSchema.safeParse({
      command: "make test",
      files: [
        {
          content: "all:\n\t@true\n",
          path: "Makefile"
        }
      ],
      mode: "assignment"
    });

    expect(result.success).toBe(false);
  });

  it("rejects file paths that escape the isolated workspace root", () => {
    const result = workspaceRunRequestSchema.safeParse({
      command: "make run",
      files: [
        {
          content: "nope",
          path: "../outside.txt"
        }
      ],
      mode: "practice",
      workspaceSessionId: "ws_assignment_demo_01"
    });

    expect(result.success).toBe(false);
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

describe("cheatingSignalSchema", () => {
  it("captures telemetry evidence instead of a boolean decision", () => {
    const result = cheatingSignalSchema.parse({
      capturedAt: "2026-03-08T08:30:00.000Z",
      confidence: 0.86,
      payload: {
        tabSwitchCount: 5
      },
      source: "problem_editor",
      type: "focus_loss",
      userId: "usr_1234567890"
    });

    expect(result.payload).toMatchObject({ tabSwitchCount: 5 });
    expect(result.source).toBe("problem_editor");
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
