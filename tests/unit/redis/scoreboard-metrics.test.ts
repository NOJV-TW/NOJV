import { describe, it, expect } from "vitest";

import { scoreboardUpdateLatency } from "@nojv/redis";

describe("scoreboard update latency metric", () => {
  it("is exported with the expected histogram shape", () => {
    expect(scoreboardUpdateLatency).toBeDefined();
    expect(typeof scoreboardUpdateLatency.record).toBe("function");
  });
});
