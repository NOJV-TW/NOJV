import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userDailyActivityRepo } from "@nojv/db";
import { userDomain } from "@nojv/domain";

import { createTestUser } from "../../fixtures/factories";

// `updateUserStats` reads `new Date()` inside the domain fn — the only way
// to land rows on specific UTC days is to freeze the system clock.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("updateUserStats — UTC date bucketing", () => {
  it("creates one row per calendar day when submissions straddle UTC midnight", async () => {
    const user = await createTestUser();

    // 2026-04-20T23:59:59Z — last second of day D.
    vi.setSystemTime(new Date("2026-04-20T23:59:59Z"));
    await userDomain.updateUserStats({
      id: "sub_1",
      userId: user.id,
      problemId: "prob_1",
      language: "cpp",
      sampleOnly: false,
      status: "accepted",
    });

    // 2026-04-21T00:00:01Z — first second of day D+1.
    vi.setSystemTime(new Date("2026-04-21T00:00:01Z"));
    await userDomain.updateUserStats({
      id: "sub_2",
      userId: user.id,
      problemId: "prob_1",
      language: "cpp",
      sampleOnly: false,
      status: "wrong_answer",
    });

    const rows = await userDailyActivityRepo.findRange(
      user.id,
      new Date("2026-04-19T00:00:00Z"),
      new Date("2026-04-22T00:00:00Z"),
    );

    // findRange orders by date DESC.
    expect(rows).toHaveLength(2);
    expect(rows[0]!.date.toISOString()).toBe("2026-04-21T00:00:00.000Z");
    expect(rows[0]!.submissionCount).toBe(1);
    expect(rows[0]!.acCount).toBe(0);
    expect(rows[1]!.date.toISOString()).toBe("2026-04-20T00:00:00.000Z");
    expect(rows[1]!.submissionCount).toBe(1);
    expect(rows[1]!.acCount).toBe(1);
  });

  it("increments the same row when multiple submissions land on the same UTC day", async () => {
    const user = await createTestUser();

    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    await userDomain.updateUserStats({
      id: "sub_1",
      userId: user.id,
      problemId: "prob_1",
      language: "cpp",
      sampleOnly: false,
      status: "accepted",
    });

    vi.setSystemTime(new Date("2026-04-20T14:30:00Z"));
    await userDomain.updateUserStats({
      id: "sub_2",
      userId: user.id,
      problemId: "prob_1",
      language: "cpp",
      sampleOnly: false,
      status: "wrong_answer",
    });

    vi.setSystemTime(new Date("2026-04-20T22:15:00Z"));
    await userDomain.updateUserStats({
      id: "sub_3",
      userId: user.id,
      problemId: "prob_2",
      language: "python",
      sampleOnly: false,
      status: "accepted",
    });

    const rows = await userDailyActivityRepo.findRange(
      user.id,
      new Date("2026-04-20T00:00:00Z"),
      new Date("2026-04-20T00:00:00Z"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.submissionCount).toBe(3);
    expect(rows[0]!.acCount).toBe(2);
  });

  it("is a no-op for sample-only submissions (no row written)", async () => {
    const user = await createTestUser();

    vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));
    await userDomain.updateUserStats({
      id: "sub_1",
      userId: user.id,
      problemId: "prob_1",
      language: "cpp",
      sampleOnly: true,
      status: "accepted",
    });

    const rows = await userDailyActivityRepo.findRange(
      user.id,
      new Date("2026-04-19T00:00:00Z"),
      new Date("2026-04-21T00:00:00Z"),
    );

    expect(rows).toHaveLength(0);
  });
});
