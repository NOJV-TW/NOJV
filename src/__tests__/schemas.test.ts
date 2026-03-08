import { describe, it, expect } from "vitest";
import { createUserSchema, createPostSchema } from "@/lib/schemas";

describe("createUserSchema", () => {
  it("should validate a valid user", () => {
    const result = createUserSchema.safeParse({
      email: "test@example.com",
      name: "John Doe",
    });
    expect(result.success).toBe(true);
  });

  it("should reject an invalid email", () => {
    const result = createUserSchema.safeParse({
      email: "not-an-email",
      name: "John Doe",
    });
    expect(result.success).toBe(false);
  });

  it("should allow missing name", () => {
    const result = createUserSchema.safeParse({
      email: "test@example.com",
    });
    expect(result.success).toBe(true);
  });
});

describe("createPostSchema", () => {
  it("should validate a valid post", () => {
    const result = createPostSchema.safeParse({
      title: "Hello World",
      content: "Some content",
      published: false,
      authorId: "cjld2cjxh0000qzrmn831i7rn",
    });
    expect(result.success).toBe(true);
  });

  it("should reject an empty title", () => {
    const result = createPostSchema.safeParse({
      title: "",
      authorId: "cjld2cjxh0000qzrmn831i7rn",
    });
    expect(result.success).toBe(false);
  });

  it("should default published to false", () => {
    const result = createPostSchema.safeParse({
      title: "Hello",
      authorId: "cjld2cjxh0000qzrmn831i7rn",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.published).toBe(false);
    }
  });
});
