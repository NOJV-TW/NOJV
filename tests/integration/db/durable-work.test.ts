import { describe, expect, it } from "vitest";

import {
  DurableWorkInvariantError,
  DurableWorkLeaseLostError,
  durableWorkRepo,
  runTransaction,
} from "@nojv/db";
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
  it("enqueues in the producer transaction and rolls back atomically", async () => {
    await expect(
      runTransaction(async (tx) => {
        await durableWorkRepo.withTx(tx).enqueue({
          kind: "test.notify",
          dedupeKey: "rolled-back",
          payload: { message: "must not escape" },
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    await expect(
      testPrisma.durableWork.findUnique({
        where: { kind_dedupeKey: { kind: "test.notify", dedupeKey: "rolled-back" } },
      }),
    ).resolves.toBeNull();
  });

  it("enqueues canonical duplicates idempotently and rejects conflicting payloads", async () => {
    const [first, duplicate] = await Promise.all([
      enqueue("same-key", { payload: { canonical: true } }),
      enqueue("same-key", { payload: { canonical: true } }),
    ]);

    expect(duplicate.id).toBe(first.id);
    const stored = await testPrisma.durableWork.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.payload).toEqual(first.payload);
    expect(await testPrisma.durableWork.count()).toBe(1);
    await expect(enqueue("same-key", { payload: { canonical: false } })).rejects.toBeInstanceOf(
      DurableWorkInvariantError,
    );
    await expect(enqueue("same-key", { maxAttempts: 9 })).rejects.toBeInstanceOf(
      DurableWorkInvariantError,
    );
    await expect(
      enqueue("same-key", { availableAt: new Date(NOW.getTime() + 1) }),
    ).rejects.toBeInstanceOf(DurableWorkInvariantError);

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

  it("cancels transactionally and fences an existing lease", async () => {
    const job = await enqueue("cancel-leased");
    const [claim] = await durableWorkRepo.claimBatch({
      kinds: ["test.notify"],
      owner: "worker-a",
      limit: 1,
      now: NOW,
      leaseDurationMs: 30_000,
    });
    const cancelledAt = new Date(NOW.getTime() + 1_000);

    await expect(
      runTransaction((tx) =>
        durableWorkRepo.withTx(tx).cancel({
          kind: "test.notify",
          dedupeKey: "cancel-leased",
          now: cancelledAt,
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      durableWorkRepo.complete({
        id: job.id,
        owner: "worker-a",
        attempt: claim.attempt,
        now: cancelledAt,
      }),
    ).rejects.toBeInstanceOf(DurableWorkLeaseLostError);
    await expect(
      testPrisma.durableWork.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      status: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: cancelledAt,
    });
  });

  it("reactivates terminal work explicitly and resets delivery state", async () => {
    const job = await enqueue("reactivate", { maxAttempts: 1 });
    const [claim] = await durableWorkRepo.claimBatch({
      kinds: ["test.notify"],
      owner: "worker-a",
      limit: 1,
      now: NOW,
      leaseDurationMs: 30_000,
    });
    await durableWorkRepo.retryOrDead({
      id: job.id,
      owner: "worker-a",
      attempt: claim.attempt,
      now: NOW,
      retryAt: NOW,
      error: "first delivery failed",
    });
    await expect(
      durableWorkRepo.reactivate({
        kind: "test.notify",
        dedupeKey: "reactivate",
        payload: { message: "changed" },
        maxAttempts: 1,
      }),
    ).rejects.toThrow("payload differs");
    await expect(
      durableWorkRepo.reactivate({
        kind: "test.notify",
        dedupeKey: "reactivate",
        payload: { message: "reactivate" },
        maxAttempts: 2,
      }),
    ).rejects.toThrow("maxAttempts differs");
    const reactivated = await durableWorkRepo.reactivate({
      kind: "test.notify",
      dedupeKey: "reactivate",
      payload: { message: "reactivate" },
      maxAttempts: 1,
    });

    expect(reactivated.id).toBe(job.id);
    await expect(
      testPrisma.durableWork.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      status: "pending",
      payload: { message: "reactivate" },
      availableAt: NOW,
      attempt: 0,
      maxAttempts: 1,
      lastError: null,
      completedAt: null,
    });
  });

  it("reschedules only active work without reviving terminal work", async () => {
    const pending = await enqueue("reschedule-pending");
    const terminal = await enqueue("reschedule-terminal");
    const [claim] = await durableWorkRepo.claimBatch({
      kinds: ["test.notify"],
      owner: "worker-a",
      limit: 1,
      now: NOW,
      leaseDurationMs: 30_000,
    });
    expect(claim.id).toBe(pending.id);
    await durableWorkRepo.complete({
      id: pending.id,
      owner: "worker-a",
      attempt: claim.attempt,
      now: NOW,
    });
    const later = new Date(NOW.getTime() + 120_000);

    await expect(
      durableWorkRepo.reschedule({
        kind: "test.notify",
        dedupeKey: "reschedule-terminal",
        availableAt: later,
        now: NOW,
      }),
    ).resolves.toBe(true);
    await expect(
      durableWorkRepo.reschedule({
        kind: "test.notify",
        dedupeKey: "reschedule-pending",
        availableAt: later,
        now: NOW,
      }),
    ).resolves.toBe(false);

    await expect(
      testPrisma.durableWork.findUniqueOrThrow({ where: { id: terminal.id } }),
    ).resolves.toMatchObject({ status: "pending", availableAt: later });
    await expect(
      testPrisma.durableWork.findUniqueOrThrow({ where: { id: pending.id } }),
    ).resolves.toMatchObject({ status: "succeeded", availableAt: NOW });
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
