import { describe, expect, it } from "vitest";

import { assessmentUpdateSchema, contestUpdateSchema, examUpdateSchema } from "@nojv/core";

const EARLY = "2030-01-01T00:00:00.000Z";
const MIDDLE = "2030-01-02T00:00:00.000Z";
const LATE = "2030-01-03T00:00:00.000Z";

describe("effective time-window update schemas", () => {
  it.each([
    ["exam", examUpdateSchema, { startsAt: LATE, endsAt: EARLY }],
    ["contest", contestUpdateSchema, { startsAt: LATE, endsAt: EARLY }],
    ["assessment", assessmentUpdateSchema, { opensAt: LATE, closesAt: EARLY }],
  ])("rejects an invalid paired %s window", (_name, schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(false);
  });

  it.each([
    ["exam start", examUpdateSchema, { startsAt: LATE }],
    ["exam end", examUpdateSchema, { endsAt: EARLY }],
    ["contest start", contestUpdateSchema, { startsAt: LATE }],
    ["contest end", contestUpdateSchema, { endsAt: EARLY }],
    ["assessment open", assessmentUpdateSchema, { opensAt: LATE }],
    ["assessment close", assessmentUpdateSchema, { closesAt: EARLY }],
    ["assessment due", assessmentUpdateSchema, { dueAt: MIDDLE }],
  ])("accepts a single %s field for persisted-state validation", (_name, schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(true);
  });

  it("validates assessment dueAt against paired opensAt and closesAt", () => {
    expect(assessmentUpdateSchema.safeParse({ opensAt: MIDDLE, dueAt: EARLY }).success).toBe(
      false,
    );
    expect(assessmentUpdateSchema.safeParse({ dueAt: LATE, closesAt: MIDDLE }).success).toBe(
      false,
    );
    expect(
      assessmentUpdateSchema.safeParse({ opensAt: EARLY, dueAt: MIDDLE, closesAt: LATE })
        .success,
    ).toBe(true);
  });

  it("allows contest frozenAt and nullable frozenAt updates", () => {
    expect(contestUpdateSchema.safeParse({ frozenAt: MIDDLE }).success).toBe(true);
    expect(contestUpdateSchema.safeParse({ frozenAt: null }).success).toBe(true);
  });

  it("allows clearing an assessment dueAt", () => {
    expect(assessmentUpdateSchema.safeParse({ dueAt: null }).success).toBe(true);
  });
});
