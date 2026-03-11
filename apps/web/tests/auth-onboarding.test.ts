import { describe, expect, it } from "vitest";

import {
  hasActorHandle,
  hasCompletedHandle,
  isValidHandle,
  readHandleFromAuthUser,
  readPlatformRole,
  readStringValue
} from "../src/lib/server/auth";

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

describe("readHandleFromAuthUser", () => {
  it("reads the username field as handle", () => {
    expect(readHandleFromAuthUser({ username: "alice" })).toBe("alice");
  });

  it("returns null for empty username", () => {
    expect(readHandleFromAuthUser({ username: "" })).toBeNull();
  });

  it("returns null when username is missing", () => {
    expect(readHandleFromAuthUser({})).toBeNull();
  });

  it("returns null when username is not a string", () => {
    expect(readHandleFromAuthUser({ username: 123 })).toBeNull();
  });
});

describe("readPlatformRole", () => {
  it("reads platformRole from user object", () => {
    expect(readPlatformRole({ platformRole: "teacher" })).toBe("teacher");
  });

  it("defaults to student when platformRole is missing", () => {
    expect(readPlatformRole({})).toBe("student");
  });

  it("defaults to student for null input", () => {
    expect(readPlatformRole(null)).toBe("student");
  });

  it("defaults to student for undefined input", () => {
    expect(readPlatformRole(undefined)).toBe("student");
  });
});

describe("hasCompletedHandle", () => {
  it("returns true when user has a non-empty username", () => {
    expect(hasCompletedHandle({ username: "alice" })).toBe(true);
  });

  it("returns false when username is empty", () => {
    expect(hasCompletedHandle({ username: "" })).toBe(false);
  });

  it("returns false when username is missing", () => {
    expect(hasCompletedHandle({})).toBe(false);
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
