import { describe, it, expect } from "vitest";

import { recordJudgeLatency } from "../../../../packages/temporal/src/activities/utils";

describe("judge latency metric", () => {
  it("records latency in seconds with mode + verdict labels", () => {
    const observed: Array<{ value: number; attrs: Record<string, string> }> = [];
    const fakeHistogram = {
      record: (value: number, attrs: Record<string, string>) => observed.push({ value, attrs }),
    };
    recordJudgeLatency(fakeHistogram as never, {
      startedAtMs: 1000,
      completedAtMs: 4500,
      mode: "standard",
      verdict: "AC",
    });
    expect(observed).toEqual([{ value: 3.5, attrs: { mode: "standard", verdict: "AC" } }]);
  });

  it("handles negative or zero duration gracefully (clamps to 0)", () => {
    const observed: Array<{ value: number; attrs: Record<string, string> }> = [];
    const fakeHistogram = {
      record: (value: number, attrs: Record<string, string>) => observed.push({ value, attrs }),
    };
    recordJudgeLatency(fakeHistogram as never, {
      startedAtMs: 5000,
      completedAtMs: 4000,
      mode: "advanced",
      verdict: "WA",
    });
    expect(observed[0]?.value).toBe(0);
  });
});
