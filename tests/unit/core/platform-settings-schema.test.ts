import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES,
  DEFAULT_SUBMIT_COOLDOWN_MIN_SEC,
  submissionPendingTimeoutMinutesSchema,
  submitCooldownMinSecSchema,
} from "@nojv/core";

describe("submissionPendingTimeoutMinutesSchema", () => {
  it("accepts integers within 10–1440 and coerces numeric strings", () => {
    expect(submissionPendingTimeoutMinutesSchema.parse(10)).toBe(10);
    expect(submissionPendingTimeoutMinutesSchema.parse(1440)).toBe(1440);
    expect(submissionPendingTimeoutMinutesSchema.parse("30")).toBe(30);
  });

  it("rejects values outside bounds and non-integers", () => {
    expect(submissionPendingTimeoutMinutesSchema.safeParse(9).success).toBe(false);
    expect(submissionPendingTimeoutMinutesSchema.safeParse(1441).success).toBe(false);
    expect(submissionPendingTimeoutMinutesSchema.safeParse(30.5).success).toBe(false);
    expect(submissionPendingTimeoutMinutesSchema.safeParse("abc").success).toBe(false);
  });

  it("keeps the default within bounds", () => {
    expect(
      submissionPendingTimeoutMinutesSchema.safeParse(
        DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES,
      ).success,
    ).toBe(true);
  });
});

describe("submitCooldownMinSecSchema", () => {
  it("accepts integers within 0–600 and coerces numeric strings", () => {
    expect(submitCooldownMinSecSchema.parse(0)).toBe(0);
    expect(submitCooldownMinSecSchema.parse(600)).toBe(600);
    expect(submitCooldownMinSecSchema.parse("30")).toBe(30);
  });

  it("rejects values outside bounds and non-integers", () => {
    expect(submitCooldownMinSecSchema.safeParse(-1).success).toBe(false);
    expect(submitCooldownMinSecSchema.safeParse(601).success).toBe(false);
    expect(submitCooldownMinSecSchema.safeParse(1.5).success).toBe(false);
    expect(submitCooldownMinSecSchema.safeParse("abc").success).toBe(false);
    expect(submitCooldownMinSecSchema.safeParse(undefined).success).toBe(false);
  });

  it("defaults to disabled", () => {
    expect(DEFAULT_SUBMIT_COOLDOWN_MIN_SEC).toBe(0);
  });
});
