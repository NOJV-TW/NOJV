import { describe, expect, it } from "vitest";
import { sessionUserSchema } from "@nojv/core";

import { hasActorUsername } from "$lib/server/auth";
import { isValidUsername } from "$lib/utils";

function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "test@example.com",
    name: "Test",
    username: null,
    platformRole: "student",
    ...overrides,
  };
}

describe("sessionUserSchema", () => {
  it("parses a valid user object with username", () => {
    const result = sessionUserSchema.safeParse(fakeUser({ username: "alice" }));
    expect(result.success && result.data.username).toBe("alice");
  });

  it("parses null username", () => {
    const result = sessionUserSchema.safeParse(fakeUser({ username: null }));
    expect(result.success && result.data.username).toBeNull();
  });

  it("rejects invalid input", () => {
    expect(sessionUserSchema.safeParse({}).success).toBe(false);
  });
});

describe("hasActorUsername", () => {
  it("returns true and narrows type when username is a non-empty string", () => {
    const actor = { username: "alice" as string | null, userId: "u1" };
    if (hasActorUsername(actor)) {
      expect(actor.username).toBe("alice");
    } else {
      throw new Error("Expected hasActorUsername to return true");
    }
  });

  it("returns false when username is null", () => {
    expect(hasActorUsername({ username: null })).toBe(false);
  });

  it("returns false when username is empty string", () => {
    expect(hasActorUsername({ username: "" })).toBe(false);
  });
});

describe("isValidUsername", () => {
  it("accepts lowercase alphanumeric with dots, underscores, and hyphens", () => {
    expect(isValidUsername("alice_bob.test-123")).toBe(true);
  });

  it("accepts minimum length of 3", () => {
    expect(isValidUsername("abc")).toBe(true);
  });

  it("rejects usernames shorter than 3 characters", () => {
    expect(isValidUsername("ab")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidUsername("")).toBe(false);
  });

  it("rejects uppercase characters", () => {
    expect(isValidUsername("Alice")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(isValidUsername("alice bob")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(isValidUsername("alice@bob")).toBe(false);
  });

  it("accepts usernames at maximum length of 64", () => {
    expect(isValidUsername("a".repeat(64))).toBe(true);
  });

  it("rejects usernames over 64 characters", () => {
    expect(isValidUsername("a".repeat(65))).toBe(false);
  });
});
