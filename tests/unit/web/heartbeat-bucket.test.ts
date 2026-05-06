import { describe, expect, it } from "vitest";

import { heartbeatGapBucket } from "../../../apps/web/src/lib/server/metrics";

describe("heartbeatGapBucket", () => {
  it("returns null for gaps <= 30s", () => {
    expect(heartbeatGapBucket(0)).toBe(null);
    expect(heartbeatGapBucket(15)).toBe(null);
    expect(heartbeatGapBucket(30)).toBe(null);
  });

  it("buckets 30s..60s as 30s_to_60s", () => {
    expect(heartbeatGapBucket(30.1)).toBe("30s_to_60s");
    expect(heartbeatGapBucket(45)).toBe("30s_to_60s");
    expect(heartbeatGapBucket(59.9)).toBe("30s_to_60s");
  });

  it("buckets 60s..120s as 60s_to_120s", () => {
    expect(heartbeatGapBucket(60)).toBe("60s_to_120s");
    expect(heartbeatGapBucket(119.9)).toBe("60s_to_120s");
  });

  it("buckets >= 120s as over_120s", () => {
    expect(heartbeatGapBucket(120)).toBe("over_120s");
    expect(heartbeatGapBucket(3600)).toBe("over_120s");
  });
});
