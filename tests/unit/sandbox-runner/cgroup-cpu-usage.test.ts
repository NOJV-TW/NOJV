import { describe, expect, it } from "vitest";

import { parseCgroupCpuUsageUsec } from "../../../apps/sandbox-runner/src/utils";

describe("parseCgroupCpuUsageUsec — CPU-time source for TLE/reporting", () => {
  it("reads usage_usec from cgroup v2 cpu.stat", () => {
    const v2 = "usage_usec 1234567\nuser_usec 1000000\nsystem_usec 234567\n";
    expect(parseCgroupCpuUsageUsec(v2, null)).toBe(1234567);
  });

  it("prefers v2 over v1 when both present", () => {
    expect(parseCgroupCpuUsageUsec("usage_usec 500\n", "9000000")).toBe(500);
  });

  it("converts cgroup v1 nanoseconds to microseconds", () => {
    expect(parseCgroupCpuUsageUsec(null, "9000000")).toBe(9000);
  });

  it("returns null when neither source is readable (graceful wall fallback)", () => {
    expect(parseCgroupCpuUsageUsec(null, null)).toBeNull();
  });

  it("returns null when v2 content lacks usage_usec and no v1", () => {
    expect(parseCgroupCpuUsageUsec("nr_periods 0\n", null)).toBeNull();
  });
});
