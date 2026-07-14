import { describe, expect, it, vi } from "vitest";

import {
  processDurableWorkBatch,
  type DurableWorkBatchRepository,
  type DurableWorkHandlerRegistry,
} from "../../../apps/worker/src/activities/durable-work-runner";

function repository(
  overrides: Partial<DurableWorkBatchRepository> = {},
): DurableWorkBatchRepository {
  return {
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => undefined),
    retryOrDead: vi.fn(async () => "retry" as const),
    ...overrides,
  };
}

const NOW = new Date("2030-01-01T00:00:00.000Z");

describe("durable work batch processor", () => {
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

    expect(result).toEqual({ claimed: 0, succeeded: 0, retried: 0, dead: 0 });
    expect(repo.claimBatch).not.toHaveBeenCalled();
    expect(ownerFactory).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  it("completes successful work with the owner and attempt fence", async () => {
    const handler = vi.fn(async () => undefined);
    const handlers: DurableWorkHandlerRegistry = { notify: handler };
    const repo = repository({
      claimBatch: vi.fn(async () => [
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
      limit: 4,
      leaseDurationMs: 20_000,
    });

    expect(repo.claimBatch).toHaveBeenCalledWith({
      kinds: ["notify"],
      owner: "owner-1",
      limit: 4,
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
    });
    expect(recordOutcome).toHaveBeenCalledWith("notify", "succeeded", new Set(["notify"]));
    expect(result).toEqual({ claimed: 1, succeeded: 1, retried: 0, dead: 0 });
  });

  it("uses bounded exponential backoff and records terminal work", async () => {
    const handler = vi.fn(async () => {
      throw new Error("delivery failed");
    });
    const repo = repository({
      claimBatch: vi.fn(async () => [
        { id: "work-1", kind: "notify", payload: {}, attempt: 4 },
      ]),
      retryOrDead: vi.fn(async () => "dead" as const),
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
    expect(result).toEqual({ claimed: 1, succeeded: 0, retried: 0, dead: 1 });
  });
});
