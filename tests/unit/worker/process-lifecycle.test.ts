import { describe, expect, it, vi } from "vitest";

import {
  createProcessLifecycle,
  type CleanupReport,
} from "../../../apps/worker/src/server-lifecycle";

function completeReport(): CleanupReport {
  return { complete: true, issues: [] };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("worker process lifecycle", () => {
  it("routes startup failure through cleanup and exits 1", async () => {
    const startupError = new Error("cannot connect");
    const shutdown = vi.fn(async () => completeReport());
    const shutdownTelemetry = vi.fn(async () => undefined);
    const exit = vi.fn();

    const lifecycle = createProcessLifecycle({
      start: () => Promise.reject(startupError),
      shutdown,
      shutdownTelemetry,
      exit,
      logger: makeLogger(),
      timeoutMs: 100,
    });

    await lifecycle.start();

    expect(shutdown).toHaveBeenCalledWith("startup failure");
    expect(shutdownTelemetry).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("coalesces repeated signals into one clean shutdown", async () => {
    let release!: () => void;
    const draining = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shutdown = vi.fn(async () => {
      await draining;
      return completeReport();
    });
    const exit = vi.fn();
    const lifecycle = createProcessLifecycle({
      start: () => new Promise<void>(() => undefined),
      shutdown,
      shutdownTelemetry: () => Promise.resolve(),
      exit,
      logger: makeLogger(),
      timeoutMs: 100,
    });

    const first = lifecycle.signal("SIGTERM");
    const second = lifecycle.signal("SIGINT");
    release();
    await Promise.all([first, second]);

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith("SIGTERM");
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("upgrades a signal shutdown to fatal exit 1", async () => {
    let release!: () => void;
    const draining = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exit = vi.fn();
    const lifecycle = createProcessLifecycle({
      start: () => new Promise<void>(() => undefined),
      shutdown: async () => {
        await draining;
        return completeReport();
      },
      shutdownTelemetry: () => Promise.resolve(),
      exit,
      logger: makeLogger(),
      timeoutMs: 100,
    });

    const stopping = lifecycle.signal("SIGTERM");
    const fatal = lifecycle.fatal("uncaught exception", new Error("boom"));
    release();
    await Promise.all([stopping, fatal]);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports incomplete cleanup without claiming judge cancellation", async () => {
    const logger = makeLogger();
    const lifecycle = createProcessLifecycle({
      start: () => new Promise<void>(() => undefined),
      shutdown: () =>
        Promise.resolve({
          complete: false,
          issues: [{ resource: "temporal worker", reason: "timed out" }],
        }),
      shutdownTelemetry: () => Promise.resolve(),
      exit: vi.fn(),
      logger,
      timeoutMs: 100,
    });

    await lifecycle.signal("SIGTERM");

    const messages = logger.error.mock.calls.map(([message]) => message).join("\n");
    expect(messages).toContain("cleanup incomplete");
    expect(messages).not.toMatch(/judge.*cancelled|cancelled.*judge/i);
  });
});
