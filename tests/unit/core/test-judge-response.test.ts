import { describe, expect, it } from "vitest";

import {
  boundedTestJudgeOutput,
  MAX_CASE_STDERR_BYTES,
  MAX_FEEDBACK_LEN,
  TEST_JUDGE_MAX_CASES,
  TEST_JUDGE_RESPONSE_BYTES,
  TEST_JUDGE_TRANSCRIPT_BYTES,
  testJudgeCaseResultSchema,
  type TestJudgeCaseResult,
} from "@nojv/core";

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function worstCase(text: (length: number) => string): TestJudgeCaseResult[] {
  return Array.from({ length: TEST_JUDGE_MAX_CASES }, () => ({
    verdict: "WA",
    teamMessage: text(MAX_FEEDBACK_LEN),
    contestantStderr: text(MAX_CASE_STDERR_BYTES),
    transcript: {
      toInteractor: text(TEST_JUDGE_TRANSCRIPT_BYTES),
      toContestant: text(TEST_JUDGE_TRANSCRIPT_BYTES),
    },
    timeMs: 12,
  }));
}

describe("boundedTestJudgeOutput", () => {
  it("returns small responses unchanged", () => {
    const cases: TestJudgeCaseResult[] = [
      { verdict: "AC", teamMessage: "ok" },
      { verdict: "TLE", transcript: { toInteractor: "1\n", toContestant: "\u0000" } },
    ];

    expect(boundedTestJudgeOutput(cases)).toEqual({ ok: true, cases });
  });

  it.each([
    ["control characters", (length: number) => "\u0001".repeat(length)],
    ["quotes", (length: number) => '"'.repeat(length)],
    ["lone surrogates", (length: number) => "\ud800".repeat(length)],
    ["three-byte characters", (length: number) => "界".repeat(Math.floor(length / 3))],
  ])("keeps the worst case of %s within the response budget", (_label, text) => {
    const output = boundedTestJudgeOutput(worstCase(text));

    const bytes = jsonBytes(output);
    expect(bytes).toBeLessThanOrEqual(TEST_JUDGE_RESPONSE_BYTES);
    expect(bytes).toBeGreaterThan(TEST_JUDGE_RESPONSE_BYTES - 1024);
    for (const result of output.cases) {
      expect(testJudgeCaseResultSchema.parse(result)).toEqual(result);
      expect(result).toMatchObject({ verdict: "WA", timeMs: 12 });
    }
  });

  it("trims the longest fields first and keeps short ones whole", () => {
    const long = "\u0001".repeat(TEST_JUDGE_TRANSCRIPT_BYTES);
    const cases: TestJudgeCaseResult[] = Array.from({ length: TEST_JUDGE_MAX_CASES }, () => ({
      verdict: "AC",
      teamMessage: "short message",
      transcript: { toInteractor: long, toContestant: "lower\n" },
    }));

    const output = boundedTestJudgeOutput(cases);

    expect(jsonBytes(output)).toBeLessThanOrEqual(TEST_JUDGE_RESPONSE_BYTES);
    for (const result of output.cases) {
      expect(result.teamMessage).toBe("short message");
      expect(result.transcript?.toContestant).toBe("lower\n");
      expect(long.startsWith(result.transcript?.toInteractor ?? "x")).toBe(true);
      expect(result.transcript?.toInteractor.length).toBeLessThan(long.length);
    }
  });
});
