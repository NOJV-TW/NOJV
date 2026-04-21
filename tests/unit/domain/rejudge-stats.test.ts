import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted repo stub so vi.mock's factory can reference it.
// The domain fn only touches `userDailyActivityRepo.adjustAcCount`, so that's
// all we need to mock. We assert on call args rather than simulating the
// repo — the clamp-at-0 behavior lives in the repo (already covered by the
// SQL `acCount: { gte: -delta }` guard) and is tested here at the delta level.
const { adjustAcCount } = vi.hoisted(() => ({ adjustAcCount: vi.fn() }));

vi.mock("@nojv/db", () => ({
  userDailyActivityRepo: { adjustAcCount },
}));

import { userDomain } from "@nojv/domain";

const { adjustUserStatsForRejudge } = userDomain;

beforeEach(() => {
  vi.clearAllMocks();
});

// Arbitrary but fixed pre-rejudge submission timestamp. adjustUserStatsForRejudge
// bucket-truncates this to UTC midnight, so the repo call should always land on
// 2026-04-15T00:00:00.000Z regardless of what "today" is.
const createdAt = new Date("2026-04-15T09:30:00Z");
const expectedDateBucket = new Date(Date.UTC(2026, 3, 15)); // month is 0-indexed

function baseSubmission(overrides: Partial<{ status: string; sampleOnly: boolean }> = {}) {
  return {
    createdAt,
    sampleOnly: false,
    status: "accepted",
    userId: "usr_1",
    ...overrides,
  };
}

describe("adjustUserStatsForRejudge — acCount delta", () => {
  it("AC → WA decrements acCount by 1 on the original submission's UTC day", async () => {
    await adjustUserStatsForRejudge(baseSubmission({ status: "wrong_answer" }), "accepted");

    expect(adjustAcCount).toHaveBeenCalledTimes(1);
    expect(adjustAcCount).toHaveBeenCalledWith({
      userId: "usr_1",
      date: expectedDateBucket,
      delta: -1,
    });
  });

  it("WA → AC increments acCount by 1", async () => {
    await adjustUserStatsForRejudge(baseSubmission({ status: "accepted" }), "wrong_answer");

    expect(adjustAcCount).toHaveBeenCalledTimes(1);
    expect(adjustAcCount).toHaveBeenCalledWith({
      userId: "usr_1",
      date: expectedDateBucket,
      delta: 1,
    });
  });

  it("AC → AC is a no-op (delta = 0, repo not called)", async () => {
    await adjustUserStatsForRejudge(baseSubmission({ status: "accepted" }), "accepted");

    expect(adjustAcCount).not.toHaveBeenCalled();
  });

  it("WA → WA is a no-op (delta = 0, repo not called)", async () => {
    await adjustUserStatsForRejudge(
      baseSubmission({ status: "wrong_answer" }),
      "wrong_answer",
    );

    expect(adjustAcCount).not.toHaveBeenCalled();
  });

  it("non-AC → non-AC across different failure verdicts is a no-op", async () => {
    // TLE → RE is still 0 AC both sides; shouldn't touch the counter.
    await adjustUserStatsForRejudge(
      baseSubmission({ status: "runtime_error" }),
      "time_limit_exceeded",
    );

    expect(adjustAcCount).not.toHaveBeenCalled();
  });

  it("non-AC failure → AC increments (any non-accepted oldStatus is treated as wasAc=false)", async () => {
    await adjustUserStatsForRejudge(
      baseSubmission({ status: "accepted" }),
      "time_limit_exceeded",
    );

    expect(adjustAcCount).toHaveBeenCalledWith({
      userId: "usr_1",
      date: expectedDateBucket,
      delta: 1,
    });
  });

  it("sequential rejudges AC → WA → AC net to zero (two opposite-sign deltas applied to same day)", async () => {
    // Flip 1: AC → WA
    await adjustUserStatsForRejudge(baseSubmission({ status: "wrong_answer" }), "accepted");
    // Flip 2: WA → AC
    await adjustUserStatsForRejudge(baseSubmission({ status: "accepted" }), "wrong_answer");

    expect(adjustAcCount).toHaveBeenCalledTimes(2);
    expect(adjustAcCount).toHaveBeenNthCalledWith(1, {
      userId: "usr_1",
      date: expectedDateBucket,
      delta: -1,
    });
    expect(adjustAcCount).toHaveBeenNthCalledWith(2, {
      userId: "usr_1",
      date: expectedDateBucket,
      delta: 1,
    });

    // Net delta applied to the day bucket is 0 — matches the pre-rejudge counter.
    const net = adjustAcCount.mock.calls.reduce(
      (acc, [args]) => acc + (args as { delta: number }).delta,
      0,
    );
    expect(net).toBe(0);
  });

  it("is a no-op for sample-only submissions (both status directions)", async () => {
    // sampleOnly is a hard gate — even a status flip shouldn't hit the repo.
    await adjustUserStatsForRejudge(
      baseSubmission({ status: "wrong_answer", sampleOnly: true }),
      "accepted",
    );
    await adjustUserStatsForRejudge(
      baseSubmission({ status: "accepted", sampleOnly: true }),
      "wrong_answer",
    );

    expect(adjustAcCount).not.toHaveBeenCalled();
  });

  it("targets the original createdAt day, not today (rejudge run on a later day)", async () => {
    // Freeze wall clock well past createdAt. If the fn read new Date() by
    // mistake it would land on 2026-05-01 instead of 2026-04-15.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
    try {
      await adjustUserStatsForRejudge(
        baseSubmission({ status: "wrong_answer" }),
        "accepted",
      );
    } finally {
      vi.useRealTimers();
    }

    expect(adjustAcCount).toHaveBeenCalledWith({
      userId: "usr_1",
      date: expectedDateBucket, // 2026-04-15, NOT 2026-05-01
      delta: -1,
    });
  });

  it("AC → WA emits delta = -1; repo clamp-at-0 guard (acCount >= -delta) is the floor", async () => {
    // The domain fn always emits the true delta (-1 here); clamping lives in
    // the repo's SQL where clause. This test pins the contract: domain emits
    // the raw delta unconditionally, repo is the one responsible for not
    // driving the row negative.
    await adjustUserStatsForRejudge(baseSubmission({ status: "wrong_answer" }), "accepted");

    expect(adjustAcCount).toHaveBeenCalledWith(
      expect.objectContaining({ delta: -1 }),
    );
  });
});
