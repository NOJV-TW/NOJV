import { describe, expect, it } from "vitest";

import { parseCgroupMemoryBytes } from "../../../apps/sandbox-runner/src/utils";

describe("parseCgroupMemoryBytes — per-case memory source from cgroup v2", () => {
  it("parses a plain byte count (memory.peak / memory.current)", () => {
    expect(parseCgroupMemoryBytes("3919872\n")).toBe(3919872);
  });

  it("trims surrounding whitespace", () => {
    expect(parseCgroupMemoryBytes("  67108864  ")).toBe(67108864);
  });

  it("returns null when the file is absent (older kernel / cgroup v1)", () => {
    expect(parseCgroupMemoryBytes(null)).toBeNull();
  });

  it("returns null for the cgroup-v2 'max' sentinel (no numeric value)", () => {
    expect(parseCgroupMemoryBytes("max\n")).toBeNull();
  });

  it("returns null for non-numeric content", () => {
    expect(parseCgroupMemoryBytes("not-a-number")).toBeNull();
  });
});
