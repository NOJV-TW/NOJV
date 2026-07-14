import { describe, expect, it } from "vitest";

import { DurableWorkLeaseLostError, durableWorkRepo } from "@nojv/db";
import { testPrisma } from "../../fixtures/factories";

const NOW = new Date("2030-01-01T00:00:00.000Z");

async function enqueue(
  dedupeKey: string,
  overrides: Partial<Parameters<typeof durableWorkRepo.enqueue>[0]> = {},
) {
  return durableWorkRepo.enqueue({
    kind: "test.notify",
    dedupeKey,
    payload: { message: dedupeKey },
    availableAt: NOW,
    ...overrides,
  });
}

describe("durable work repository", () => {
  it("enqueues idempotently by kind and dedupe key without mutating the winner", async () => {
    const [first, duplicate] = await Promise.all([
      enqueue("same-key", { payload: { winner: true } }),
      enqueue("same-key", { payload: { winner: false } }),
    ]);

    expect(duplicate.id).toBe(first.id);
    const stored = await testPrisma.durableWork.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.payload).toEqual(first.payload);
    expect(await testPrisma.durableWork.count()).toBe(1);

    const otherKind = await enqueue("same-key", { kind: "test.reindex" });
    expect(otherKind.id).not.toBe(first.id);
  });

  it("atomically gives concurrent claimants disjoint work", async () => {
    const jobs = await Promise.all([enqueue("claim-1"), enqueue("claim-2")]);
    const claim = (owner: string) =>
      durableWorkRepo.claimBatch({
        kinds: ["test.notify"],
        owner,
        limit: 1,
        now: NOW,
        leaseDurationMs: 30_000,
      });

    const [left, right] = await Promise.all([claim("worker-a"), claim("worker-b")]);

    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    expect(new Set([left[0].id, right[0].id])).toEqual(new Set(jobs.map((job) => job.id)));
    expect(left[0].leaseOwner).toBe("worker-a");
    expect(right[0].leaseOwner).toBe("worker-b");
  });

  it("reclaims expired leases while fencing stale claimants by owner and attempt", async () => {
    const job = await enqueue("reclaim");
    const [firstClaim] = await durableWorkRepo.claimBatch({
      kinds: ["test.notify"],
      owner: "worker-a",
      limit: 1,
      now: NOW,
      leaseDurationMs: 1_000,
    });
    const reclaimedAt = new Date(NOW.getTime() + 1_001);
    const [secondClaim] = await durableWorkRepo.claimBatch({
      kinds: ["test.notify"],
      owner: "worker-b",
      limit: 1,
      now: reclaimedAt,
      leaseDurationMs: 1_000,
    });

    expect(firstClaim).toMatchObject({ id: job.id, attempt: 1 });
    expect(secondClaim).toMatchObject({ id: job.id, attempt: 2 });
    await expect(
      durableWorkRepo.complete({
        id: job.id,
        owner: "worker-a",
        attempt: 1,
        now: reclaimedAt,
      }),
    ).rejects.toBeInstanceOf(DurableWorkLeaseLostError);

    await durableWorkRepo.complete({
      id: job.id,
      owner: "worker-b",
      attempt: 2,
      now: reclaimedAt,
    });
    await expect(
      testPrisma.durableWork.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: reclaimedAt,
    });
  });

  it("rejects a claimant as soon as its lease expires", async () => {
    const job = await enqueue("expired-fence");
    const [claim] = await durableWorkRepo.claimBatch({
      kinds: ["test.notify"],
      owner: "worker-a",
      limit: 1,
      now: NOW,
      leaseDurationMs: 1_000,
    });

    await expect(
      durableWorkRepo.complete({
        id: job.id,
        owner: "worker-a",
        attempt: claim.attempt,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).rejects.toBeInstanceOf(DurableWorkLeaseLostError);
  });

  it("honors retry availability and marks the final failed attempt dead", async () => {
    const job = await enqueue("retry", { maxAttempts: 2 });
    const [first] = await durableWorkRepo.claimBatch({
      kinds: ["test.notify"],
      owner: "worker-a",
      limit: 1,
      now: NOW,
      leaseDurationMs: 1_000,
    });
    const retryAt = new Date(NOW.getTime() + 5_000);

    await expect(
      durableWorkRepo.retryOrDead({
        id: job.id,
        owner: "worker-a",
        attempt: first.attempt,
        now: NOW,
        retryAt,
        error: "transient",
      }),
    ).resolves.toBe("retry");
    await expect(
      durableWorkRepo.claimBatch({
        kinds: ["test.notify"],
        owner: "worker-b",
        limit: 1,
        now: new Date(retryAt.getTime() - 1),
        leaseDurationMs: 1_000,
      }),
    ).resolves.toEqual([]);

    const [second] = await durableWorkRepo.claimBatch({
      kinds: ["test.notify"],
      owner: "worker-b",
      limit: 1,
      now: retryAt,
      leaseDurationMs: 1_000,
    });
    await expect(
      durableWorkRepo.retryOrDead({
        id: job.id,
        owner: "worker-b",
        attempt: second.attempt,
        now: retryAt,
        retryAt: new Date(retryAt.getTime() + 10_000),
        error: "permanent",
      }),
    ).resolves.toBe("dead");

    await expect(
      testPrisma.durableWork.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      status: "dead",
      attempt: 2,
      lastError: "permanent",
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: retryAt,
    });
  });
});
