import { describe, it, expect } from "vitest";
import {
  sseConnectionDuration,
  sseConnectionDroppedTotal,
} from "../../../apps/web/src/lib/server/metrics";

describe("SSE lifecycle metrics", () => {
  it("exports histogram with record", () => {
    expect(sseConnectionDuration).toBeDefined();
    expect(typeof sseConnectionDuration.record).toBe("function");
  });

  it("exports counter with add", () => {
    expect(sseConnectionDroppedTotal).toBeDefined();
    expect(typeof sseConnectionDroppedTotal.add).toBe("function");
  });
});
