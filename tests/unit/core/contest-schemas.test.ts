import { describe, expect, it } from "vitest";

import { contestCreateSchema } from "../../../packages/core/src/index";

const baseContestInput = {
  allowedLanguages: [],
  endsAt: "2026-05-03T17:00:00.000Z",
  frozenAt: undefined,
  ipBindingEnabled: false,
  ipViolationMode: "block",
  ipWhitelistEnabled: false,
  ipWhitelist: [],
  pageLockEnabled: false,
  scoreboardMode: "live",
  scoringMode: "problem_count",
  slug: "midterm-2026",
  startsAt: "2026-05-03T14:00:00.000Z",
  submitCooldownSec: 0,
  summary: "Midterm exam covering sorting and searching.",
  title: "Midterm 2026"
};

describe("contestCreateSchema", () => {
  it("accepts problemIds containing underscores (actual DB ids like problem_warmup-sum)", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problemIds: ["problem_warmup-sum", "problem_add-two-numbers"]
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty problemIds array", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problemIds: []
    });

    expect(result.success).toBe(false);
  });

  it("rejects problemIds whose entries are empty strings", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problemIds: [""]
    });

    expect(result.success).toBe(false);
  });

  it("still rejects endsAt earlier than startsAt", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problemIds: ["problem_warmup-sum"],
      startsAt: "2026-05-03T17:00:00.000Z",
      endsAt: "2026-05-03T14:00:00.000Z"
    });

    expect(result.success).toBe(false);
  });
});
