import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES,
  submissionPendingTimeoutMinutesSchema,
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
