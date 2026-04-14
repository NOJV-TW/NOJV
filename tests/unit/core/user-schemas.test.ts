import { describe, expect, it } from "vitest";

import { userHandleSchema } from "../../../packages/core/src/index";

describe("userHandleSchema", () => {
  it("accepts common NTU / NTUST prefixed handles", () => {
    expect(userHandleSchema.parse("ntu_b11902001")).toBe("ntu_b11902001");
    expect(userHandleSchema.parse("ntust_b11902001")).toBe("ntust_b11902001");
  });

  it("accepts plain NTNU-style ids", () => {
    expect(userHandleSchema.parse("41034049s")).toBe("41034049s");
  });

  it("trims leading/trailing whitespace from pasted input", () => {
    expect(userHandleSchema.parse("  ntu_b11902001  ")).toBe("ntu_b11902001");
  });

  it("rejects dots and hyphens — stricter than better-auth's username regex", () => {
    expect(userHandleSchema.safeParse("b.11902001").success).toBe(false);
    expect(userHandleSchema.safeParse("b-11902001").success).toBe(false);
  });

  it("rejects uppercase input", () => {
    expect(userHandleSchema.safeParse("NTU_B11902001").success).toBe(false);
  });

  it("rejects email addresses pasted by accident", () => {
    expect(userHandleSchema.safeParse("b11902001@ntu.edu.tw").success).toBe(false);
  });

  it("enforces length bounds", () => {
    expect(userHandleSchema.safeParse("ab").success).toBe(false);
    expect(userHandleSchema.safeParse("a".repeat(33)).success).toBe(false);
    expect(userHandleSchema.safeParse("abc").success).toBe(true);
    expect(userHandleSchema.safeParse("a".repeat(32)).success).toBe(true);
  });
});
