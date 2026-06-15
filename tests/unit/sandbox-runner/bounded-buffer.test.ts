import { describe, expect, it } from "vitest";

import { createBoundedBuffer } from "../../../apps/sandbox-runner/src/utils";

describe("createBoundedBuffer", () => {
  it("passes small inputs through unchanged", () => {
    const buf = createBoundedBuffer(1024);
    buf.push(Buffer.from("hello "));
    buf.push(Buffer.from("world"));
    expect(buf.toString()).toBe("hello world");
    expect(buf.truncated).toBe(false);
  });

  it("returns empty string when nothing was pushed", () => {
    const buf = createBoundedBuffer(1024);
    expect(buf.toString()).toBe("");
    expect(buf.truncated).toBe(false);
  });

  it("truncates when a single chunk exceeds the cap", () => {
    const buf = createBoundedBuffer(8);
    buf.push(Buffer.from("abcdefghij")); // 10 bytes > 8 cap
    expect(buf.truncated).toBe(true);
    const out = buf.toString();
    expect(out.startsWith("abcdefgh")).toBe(true);
    expect(out).toContain("[output truncated");
  });

  it("truncates when multiple chunks cumulatively exceed the cap", () => {
    const buf = createBoundedBuffer(10);
    buf.push(Buffer.from("abcd")); // 4 bytes — fits
    buf.push(Buffer.from("efgh")); // 8 bytes total — fits
    buf.push(Buffer.from("ijklmn")); // would push to 14 — truncated to 10
    expect(buf.truncated).toBe(true);
    const out = buf.toString();
    expect(out.startsWith("abcdefghij")).toBe(true);
    expect(out).toContain("[output truncated");
  });

  it("drops subsequent chunks silently once truncated", () => {
    const buf = createBoundedBuffer(4);
    buf.push(Buffer.from("xxxx")); // exactly at cap
    buf.push(Buffer.from("yyyy")); // should be dropped
    buf.push(Buffer.from("zzzz")); // should also be dropped
    const out = buf.toString();
    const rawKept = out.replace(/\n\[output truncated.*$/, "");
    expect(rawKept).toBe("xxxx");
    expect(rawKept).not.toContain("y");
    expect(rawKept).not.toContain("z");
    expect(buf.truncated).toBe(true);
  });

  it("regression: an unbounded runaway stream would have OOMed the runner", () => {
    const cap = 1024;
    const buf = createBoundedBuffer(cap);
    const chunk = Buffer.alloc(4096, 0x61); // 4 KB of 'a'
    for (let i = 0; i < 100; i++) buf.push(chunk);
    const out = buf.toString();
    expect(out.replace(/\n\[output truncated.*$/, "").length).toBeLessThanOrEqual(cap);
    expect(buf.truncated).toBe(true);
  });
});
