import { describe, expect, it } from "vitest";

import {
  hasActorHandle,
  isValidHandle,
  readStringValue
} from "$lib/server/auth";
import { parseSessionUser } from "$lib/session";

/** Helper to build a minimal valid session-user-like object. */
function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "test@example.com",
    name: "Test",
    handle: null,
    platformRole: "student",
    ...overrides
  };
}

describe("readStringValue", () => {
  it("returns the string when value is a string", () => {
    expect(readStringValue("hello")).toBe("hello");
  });

  it("returns undefined for numbers", () => {
    expect(readStringValue(42)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(readStringValue(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(readStringValue(undefined)).toBeUndefined();
  });

  it("returns empty string for empty string", () => {
    expect(readStringValue("")).toBe("");
  });
});

describe("parseSessionUser", () => {
  it("reads the handle field from a valid user object", () => {
    expect(parseSessionUser(fakeUser({ handle: "alice" }))?.handle).toBe("alice");
  });

  it("falls back to username field when handle is absent", () => {
    const { handle: _, ...userWithoutHandle } = fakeUser();
    expect(parseSessionUser({ ...userWithoutHandle, username: "alice" })?.handle).toBe("alice");
  });

  it("returns null handle when handle is null and no username", () => {
    expect(parseSessionUser(fakeUser({ handle: null }))?.handle).toBeNull();
  });

  it("returns null when input is not a valid user object", () => {
    expect(parseSessionUser({})).toBeNull();
  });

  it("returns null when input is null", () => {
    expect(parseSessionUser(null)).toBeNull();
  });
});

describe("hasActorHandle", () => {
  it("returns true and narrows type when handle is a non-empty string", () => {
    const actor = { handle: "alice" as string | null, userId: "u1" };
    if (hasActorHandle(actor)) {
      // Type should be narrowed - handle is string, not null
      expect(actor.handle).toBe("alice");
    } else {
      throw new Error("Expected hasActorHandle to return true");
    }
  });

  it("returns false when handle is null", () => {
    expect(hasActorHandle({ handle: null })).toBe(false);
  });

  it("returns false when handle is empty string", () => {
    expect(hasActorHandle({ handle: "" })).toBe(false);
  });
});

describe("isValidHandle", () => {
  it("accepts lowercase alphanumeric with dots, underscores, and hyphens", () => {
    expect(isValidHandle("alice_bob.test-123")).toBe(true);
  });

  it("accepts minimum length of 3", () => {
    expect(isValidHandle("abc")).toBe(true);
  });

  it("rejects handles shorter than 3 characters", () => {
    expect(isValidHandle("ab")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidHandle("")).toBe(false);
  });

  it("rejects uppercase characters", () => {
    expect(isValidHandle("Alice")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(isValidHandle("alice bob")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(isValidHandle("alice@bob")).toBe(false);
  });

  it("accepts handles at maximum length of 64", () => {
    expect(isValidHandle("a".repeat(64))).toBe(true);
  });

  it("rejects handles over 64 characters", () => {
    expect(isValidHandle("a".repeat(65))).toBe(false);
  });
});
