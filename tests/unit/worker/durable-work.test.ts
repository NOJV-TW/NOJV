import { describe, expect, it, vi } from "vitest";

import {
  processDurableWorkBatch,
  type DurableWorkBatchRepository,
  type DurableWorkClaimOptions,
  type DurableWorkHandlerRegistry,
} from "../../../apps/worker/src/activities/durable-work-runner";
import {
  DURABLE_WORK_ACTIVITY_MAX_ATTEMPTS,
  DURABLE_WORK_ACTIVITY_TIMEOUT_MS,
  DURABLE_WORK_LEASE_DURATION_MS,
} from "../../../apps/worker/src/durable-work-config";

function repository(
  overrides: Partial<DurableWorkBatchRepository> = {},
): DurableWorkBatchRepository {
  return {
    claimBatch: vi.fn().mockResolvedValue([]),
    complete: vi.fn().mockResolvedValue(undefined),
    retryOrDead: vi.fn().mockResolvedValue("retry" as const),
    ...overrides,
  };
}

const NOW = new Date("2030-01-01T00:00:00.000Z");

describe("durable work batch processor", () => {
  it("keeps database retry as the only retry owner and the lease beyond activity timeout", () => {
    expect(DURABLE_WORK_ACTIVITY_MAX_ATTEMPTS).toBe(1);
    expect(DURABLE_WORK_LEASE_DURATION_MS).toBeGreaterThan(DURABLE_WORK_ACTIVITY_TIMEOUT_MS);
  });

  it("is a strict no-op when no handlers are registered", async () => {
    const repo = repository();
    const ownerFactory = vi.fn(() => "owner-1");
    const recordOutcome = vi.fn();
    const clock = vi.fn(() => NOW);

    const result = await processDurableWorkBatch({
      repository: repo,
      handlers: {},
      ownerFactory,
      recordOutcome,
      clock,
    });

    expect(result).toEqual({
      claimed: 0,
      succeeded: 0,
      retried: 0,
      dead: 0,
      processedKind: null,
    });
    expect(repo.claimBatch).not.toHaveBeenCalled();
    expect(ownerFactory).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  it("completes successful work with the owner and attempt fence", async () => {
    const handler = vi.fn().mockResolvedValue({ outcome: "delivered" });
    const handlers: DurableWorkHandlerRegistry = { notify: handler };
    const repo = repository({
      claimBatch: vi
        .fn()
        .mockResolvedValue([
          { id: "work-1", kind: "notify", payload: { userId: "u1" }, attempt: 3 },
        ]),
    });
    const recordOutcome = vi.fn();

    const result = await processDurableWorkBatch({
      repository: repo,
      handlers,
      ownerFactory: () => "owner-1",
      recordOutcome,
      clock: () => NOW,
      leaseDurationMs: 20_000,
    });

    expect(repo.claimBatch).toHaveBeenCalledWith({
      kinds: ["notify"],
      owner: "owner-1",
      limit: 1,
      now: NOW,
      leaseDurationMs: 20_000,
    });
    expect(handler).toHaveBeenCalledWith(
      { userId: "u1" },
      { id: "work-1", kind: "notify", attempt: 3 },
    );
    expect(repo.complete).toHaveBeenCalledWith({
      id: "work-1",
      owner: "owner-1",
      attempt: 3,
      now: NOW,
      result: { outcome: "delivered" },
    });
    expect(recordOutcome).toHaveBeenCalledWith("notify", "succeeded", new Set(["notify"]));
    expect(result).toEqual({
      claimed: 1,
      succeeded: 1,
      retried: 0,
      dead: 0,
      processedKind: "notify",
    });
  });

  it("may call SMTP twice when acceptance succeeds before durable completion", async () => {
    const smtpSend = vi.fn().mockResolvedValue("accepted");
    const handler = vi.fn(async () => {
      await smtpSend({ messageId: "<notification.notification-1@nojv.local>" });
      return { outcome: "accepted", deliverySemantics: "at_least_once" };
    });
    const repo = repository({
      claimBatch: vi
        .fn()
        .mockResolvedValueOnce([
          { id: "work-1", kind: "notification.email", payload: {}, attempt: 1 },
        ])
        .mockResolvedValueOnce([
          { id: "work-1", kind: "notification.email", payload: {}, attempt: 2 },
        ]),
      complete: vi
        .fn()
        .mockRejectedValueOnce(new Error("completion unavailable after SMTP acceptance"))
        .mockResolvedValueOnce(undefined),
    });
    const dependencies = {
      repository: repo,
      handlers: { "notification.email": handler },
      ownerFactory: vi.fn().mockReturnValueOnce("owner-1").mockReturnValueOnce("owner-2"),
      recordOutcome: vi.fn(),
      clock: () => NOW,
    };

    await expect(processDurableWorkBatch(dependencies)).rejects.toThrow(
      "completion unavailable after SMTP acceptance",
    );
    await expect(processDurableWorkBatch(dependencies)).resolves.toMatchObject({
      succeeded: 1,
    });

    expect(smtpSend).toHaveBeenCalledTimes(2);
    expect(smtpSend).toHaveBeenNthCalledWith(1, {
      messageId: "<notification.notification-1@nojv.local>",
    });
    expect(smtpSend).toHaveBeenNthCalledWith(2, {
      messageId: "<notification.notification-1@nojv.local>",
    });
    expect(repo.retryOrDead).not.toHaveBeenCalled();
  });

  it("rotates the preferred kind by fairness slot so concurrent workers cover every backlog", async () => {
    const repo = repository({
      claimBatch: vi.fn(({ kinds }: DurableWorkClaimOptions) => {
        const kind = kinds[0];
        return Promise.resolve(
          kind === "rejudge" ? [] : [{ id: `work-${kind}`, kind, payload: {}, attempt: 1 }],
        );
      }),
    });
    const handlers: DurableWorkHandlerRegistry = {
      notification: vi.fn().mockResolvedValue(undefined),
      rejudge: vi.fn().mockResolvedValue(undefined),
      submission: vi.fn().mockResolvedValue(undefined),
    };

    const afterNotification = await processDurableWorkBatch(
      {
        repository: repo,
        handlers,
        ownerFactory: () => "owner-1",
        recordOutcome: vi.fn(),
        clock: () => NOW,
      },
      { fairnessOffset: 1 },
    );
    if (!afterNotification.processedKind) throw new Error("Expected claimed work kind.");
    const afterSubmission = await processDurableWorkBatch(
      {
        repository: repo,
        handlers,
        ownerFactory: () => "owner-2",
        recordOutcome: vi.fn(),
        clock: () => NOW,
      },
      { fairnessOffset: 2 },
    );

    expect(repo.claimBatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kinds: ["rejudge"] }),
    );
    expect(repo.claimBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kinds: ["submission"] }),
    );
    expect(repo.claimBatch).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ kinds: ["submission"] }),
    );
    expect(afterNotification.processedKind).toBe("submission");
    expect(afterSubmission.processedKind).toBe("submission");
  });

  it("claims only one item so a slow handler cannot expire later unstarted leases", async () => {
    let now = NOW;
    const pending = [
      { id: "work-1", kind: "notify", payload: {}, attempt: 1 },
      { id: "work-2", kind: "notify", payload: {}, attempt: 1 },
    ];
    const repo = repository({
      claimBatch: vi.fn(({ limit }: DurableWorkClaimOptions) =>
        Promise.resolve(pending.slice(0, limit)),
      ),
    });
    const handler = vi.fn(() => {
      now = new Date(NOW.getTime() + DURABLE_WORK_LEASE_DURATION_MS - 1);
      return Promise.resolve(undefined);
    });

    const result = await processDurableWorkBatch({
      repository: repo,
      handlers: { notify: handler },
      ownerFactory: () => "owner-1",
      recordOutcome: vi.fn(),
      clock: () => now,
    });

    expect(repo.claimBatch).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    expect(handler).toHaveBeenCalledOnce();
    expect(result.claimed).toBe(1);
  });

  it("uses bounded exponential backoff and records terminal work", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("delivery failed"));
    const repo = repository({
      claimBatch: vi
        .fn()
        .mockResolvedValue([{ id: "work-1", kind: "notify", payload: {}, attempt: 4 }]),
      retryOrDead: vi.fn().mockResolvedValue("dead" as const),
    });
    const recordOutcome = vi.fn();

    const result = await processDurableWorkBatch({
      repository: repo,
      handlers: { notify: handler },
      ownerFactory: () => "owner-1",
      recordOutcome,
      clock: () => NOW,
      baseRetryDelayMs: 1_000,
      maxRetryDelayMs: 4_000,
    });

    expect(repo.retryOrDead).toHaveBeenCalledWith({
      id: "work-1",
      owner: "owner-1",
      attempt: 4,
      now: NOW,
      retryAt: new Date("2030-01-01T00:00:04.000Z"),
      error: "delivery failed",
    });
    expect(recordOutcome).toHaveBeenCalledWith("notify", "dead", new Set(["notify"]));
    expect(result).toEqual({
      claimed: 1,
      succeeded: 0,
      retried: 0,
      dead: 1,
      processedKind: "notify",
    });
  });
});
