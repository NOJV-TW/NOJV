import { describe, expect, it } from "vitest";

import { changeEmailSchema } from "$lib/../routes/(app)/settings/email-schema";

describe("changeEmailSchema", () => {
  it("normalizes surrounding whitespace and casing", () => {
    expect(changeEmailSchema.parse({ newEmail: "  New.User@Example.COM  " })).toEqual({
      newEmail: "new.user@example.com",
    });
  });

  it("rejects malformed email addresses", () => {
    expect(changeEmailSchema.safeParse({ newEmail: "not-an-email" }).success).toBe(false);
  });

  it("rejects an empty email address", () => {
    expect(changeEmailSchema.safeParse({ newEmail: "   " }).success).toBe(false);
  });
});
