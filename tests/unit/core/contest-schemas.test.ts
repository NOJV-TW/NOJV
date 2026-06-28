import { describe, expect, it } from "vitest";

import {
  contestCreateSchema,
  contestSettingsFormSchema,
  contestUpdateSchema,
} from "../../../packages/core/src/index";

const baseContestInput = {
  allowedLanguages: [],
  endsAt: "2026-05-03T17:00:00.000Z",
  frozenAt: undefined,
  scoreboardMode: "live",
  scoringMode: "problem_count",
  id: "midterm-2026",
  startsAt: "2026-05-03T14:00:00.000Z",
  submitCooldownSec: 0,
  summary: "Midterm exam covering sorting and searching.",
  title: "Midterm 2026",
};

describe("contestCreateSchema", () => {
  it("accepts per-problem {problemId, points} entries with underscore ids", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problems: [
        { problemId: "problem_warmup-sum", points: 100 },
        { problemId: "problem_add-two-numbers", points: 300 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("defaults points to 100 when omitted", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problems: [{ problemId: "problem_warmup-sum" }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.problems[0]!.points).toBe(100);
    }
  });

  it("rejects empty problems array", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problems: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a problem whose problemId is an empty string", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problems: [{ problemId: "", points: 100 }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects points below 1", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problems: [{ problemId: "problem_warmup-sum", points: 0 }],
    });

    expect(result.success).toBe(false);
  });

  it("still rejects endsAt earlier than startsAt", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problems: [{ problemId: "problem_warmup-sum", points: 100 }],
      startsAt: "2026-05-03T17:00:00.000Z",
      endsAt: "2026-05-03T14:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("contest settings — short title is a form error, never an unhandled 500", () => {
  it("the permissive settings form schema accepts a short title", () => {
    const result = contestSettingsFormSchema.safeParse({ title: "ab" });
    expect(result.success).toBe(true);
  });

  it("contestUpdateSchema rejects the short title via safeParse (the 400 path)", () => {
    const result = contestUpdateSchema.safeParse({ title: "ab" });
    expect(result.success).toBe(false);
  });

  it("contestUpdateSchema accepts a valid title length", () => {
    const result = contestUpdateSchema.safeParse({ title: "Final Round" });
    expect(result.success).toBe(true);
  });
});
