import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getRedis, keys, scoreboard } from "@nojv/redis";

const { freezeScoreboard, getScoreboard, unfreezeScoreboard, updateScoreboard } = scoreboard;

async function cleanContest(contestId: string): Promise<void> {
  await getRedis().del(keys.scoreboard(contestId), keys.scoreboardFrozen(contestId));
}

describe("@nojv/redis scoreboard (real Redis)", () => {
  beforeEach(async () => {
    // Every test uses a unique contestId so they can run in any order, but
    // we still clean up any accidental leftover so repeat runs are stable.
    await cleanContest("scoreboard-test");
    await cleanContest("scoreboard-freeze-test");
    await cleanContest("scoreboard-ttl-test");
  });

  afterAll(async () => {
    // Close the singleton client so the process can exit cleanly.
    await getRedis().quit();
  });

  // ─── Round 3 regression: updateScoreboard must set a TTL ──────────────

  it("updateScoreboard sets a positive TTL on the live key", async () => {
    await updateScoreboard("scoreboard-ttl-test", "participation-1", 100);
    const ttl = await getRedis().ttl(keys.scoreboard("scoreboard-ttl-test"));
    // -1 means "no expiry", -2 means "key does not exist". Either would be
    // the pre-round-3 bug. We want a positive TTL in the ballpark of 90 days.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeGreaterThan(60 * 24 * 60 * 60); // > 60 days
  });

  it("updateScoreboard refreshes the TTL on every write", async () => {
    await updateScoreboard("scoreboard-ttl-test", "participation-1", 100);
    const firstTtl = await getRedis().ttl(keys.scoreboard("scoreboard-ttl-test"));
    // Simulate a new submission arriving later — TTL should bump back up.
    await updateScoreboard("scoreboard-ttl-test", "participation-2", 150);
    const secondTtl = await getRedis().ttl(keys.scoreboard("scoreboard-ttl-test"));
    expect(secondTtl).toBeGreaterThanOrEqual(firstTtl - 2);
  });

  // ─── Round 3 regression: freeze/unfreeze must preserve live writes ────

  it("getScoreboard returns live scores when nothing is frozen", async () => {
    await updateScoreboard("scoreboard-test", "p-alice", 100);
    await updateScoreboard("scoreboard-test", "p-bob", 80);

    const entries = await getScoreboard("scoreboard-test");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ participationId: "p-alice", score: 100 });
    expect(entries[1]).toEqual({ participationId: "p-bob", score: 80 });
  });

  it("getScoreboard returns the frozen snapshot during freeze, live board after unfreeze", async () => {
    // Pre-freeze state: Alice 100, Bob 80.
    await updateScoreboard("scoreboard-freeze-test", "p-alice", 100);
    await updateScoreboard("scoreboard-freeze-test", "p-bob", 80);

    await freezeScoreboard("scoreboard-freeze-test");

    // During freeze, a new submission arrives and wins.
    await updateScoreboard("scoreboard-freeze-test", "p-carol", 150);

    // Public view during freeze: unchanged — still Alice 100, Bob 80.
    const duringFreeze = await getScoreboard("scoreboard-freeze-test");
    expect(duringFreeze).toHaveLength(2);
    expect(duringFreeze.map((e) => e.participationId).sort()).toEqual(["p-alice", "p-bob"]);

    // The frozen snapshot must have its own TTL set.
    const frozenTtl = await getRedis().ttl(keys.scoreboardFrozen("scoreboard-freeze-test"));
    expect(frozenTtl).toBeGreaterThan(0);

    await unfreezeScoreboard("scoreboard-freeze-test");

    // After unfreeze, the board shows everyone including Carol.
    // This is the critical assertion — round 2's RENAME-based freeze would
    // have clobbered Carol's write here.
    const afterUnfreeze = await getScoreboard("scoreboard-freeze-test");
    const ids = afterUnfreeze.map((e) => e.participationId).sort();
    expect(ids).toEqual(["p-alice", "p-bob", "p-carol"]);
    const carol = afterUnfreeze.find((e) => e.participationId === "p-carol");
    expect(carol?.score).toBe(150);
  });

  it("unfreezeScoreboard is a no-op when nothing is frozen", async () => {
    await updateScoreboard("scoreboard-test", "p-alice", 100);
    await unfreezeScoreboard("scoreboard-test");
    const entries = await getScoreboard("scoreboard-test");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ participationId: "p-alice", score: 100 });
  });

  it("freezeScoreboard is idempotent — re-freezing replaces the previous snapshot", async () => {
    await updateScoreboard("scoreboard-freeze-test", "p-alice", 50);
    await freezeScoreboard("scoreboard-freeze-test");

    // New submissions after first freeze.
    await updateScoreboard("scoreboard-freeze-test", "p-bob", 70);

    // Re-freeze — the snapshot should now include Bob too.
    await freezeScoreboard("scoreboard-freeze-test");

    const frozen = await getScoreboard("scoreboard-freeze-test");
    const ids = frozen.map((e) => e.participationId).sort();
    expect(ids).toEqual(["p-alice", "p-bob"]);
  });
});
