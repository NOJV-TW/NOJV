import { describe, expect, it } from "vitest";

import { computeReminderCheckpoints } from "../../../apps/worker/src/workflows/reminder-checkpoints";

const DAY = 86_400_000;
const target = new Date("2026-08-01T00:00:00.000Z").getTime();

describe("computeReminderCheckpoints", () => {
  it("emits every lead day across a full 7-day window", () => {
    const now = new Date("2026-07-01T00:00:00.000Z").getTime();
    const out = computeReminderCheckpoints(target, 0, now);

    expect(out.map((c) => c.leadDays)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(out[0]!.atMs).toBe(target - 7 * DAY);
    expect(out.at(-1)!.atMs).toBe(target - 1 * DAY);
  });

  it("drops checkpoints earlier than notBefore", () => {
    const notBefore = target - 4 * DAY;
    const now = new Date("2026-07-01T00:00:00.000Z").getTime();
    const out = computeReminderCheckpoints(target, notBefore, now);

    expect(out.map((c) => c.leadDays)).toEqual([4, 3, 2, 1]);
  });

  it("skips checkpoints already in the past", () => {
    const now = new Date("2026-07-28T12:00:00.000Z").getTime();
    const out = computeReminderCheckpoints(target, 0, now);

    expect(out.map((c) => c.leadDays)).toEqual([3, 2, 1]);
  });

  it("retains a checkpoint that passed within the grace window", () => {
    const now = target - 3 * DAY + 5 * 60_000;
    const out = computeReminderCheckpoints(target, 0, now);

    expect(out.map((c) => c.leadDays)).toEqual([3, 2, 1]);
  });

  it("skips a checkpoint that passed beyond the grace window", () => {
    const now = target - 3 * DAY + 15 * 60_000;
    const out = computeReminderCheckpoints(target, 0, now);

    expect(out.map((c) => c.leadDays)).toEqual([2, 1]);
  });

  it("returns empty once every checkpoint has passed", () => {
    const now = new Date("2026-08-02T00:00:00.000Z").getTime();
    const out = computeReminderCheckpoints(target, 0, now);

    expect(out).toEqual([]);
  });

  it("returns checkpoints ordered by ascending atMs", () => {
    const now = new Date("2026-07-01T00:00:00.000Z").getTime();
    const out = computeReminderCheckpoints(target, 0, now);

    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.atMs).toBeGreaterThan(out[i - 1]!.atMs);
    }
  });

  it("honors a custom maxLeadDays", () => {
    const now = new Date("2026-07-01T00:00:00.000Z").getTime();
    const out = computeReminderCheckpoints(target, 0, now, 3);

    expect(out.map((c) => c.leadDays)).toEqual([3, 2, 1]);
  });
});
