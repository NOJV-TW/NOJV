import type { SandboxExecutor, SandboxRequest } from "@nojv/core";
import { describe, expect, it, vi } from "vitest";

import { ExecutorOwner } from "../../../apps/worker/src/services/executor-owner";

const request = { submissionId: "submission" } as SandboxRequest;

describe("ExecutorOwner", () => {
  it("gives every execution a unique run identity", async () => {
    const contexts: Parameters<SandboxExecutor["execute"]>[1][] = [];
    const executor: SandboxExecutor = {
      execute: vi.fn(async (_request, execution) => {
        contexts.push(execution);
        return { testcaseResults: [] };
      }),
    };
    const ids = ["run-a", "run-b"];
    const owner = new ExecutorOwner(executor, () => ids.shift()!);

    await Promise.all([
      owner.execute(request, new AbortController().signal),
      owner.execute(request, new AbortController().signal),
    ]);

    expect(contexts.map(({ runId }) => runId)).toEqual(["run-a", "run-b"]);
    expect(contexts[0]?.signal).not.toBe(contexts[1]?.signal);
    expect(owner.activeCount).toBe(0);
  });

  it("propagates cancellation and does not finish shutdown before execution cleanup", async () => {
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const observed: AbortSignal[] = [];
    const executor: SandboxExecutor = {
      execute: vi.fn(async (_request, { signal }) => {
        observed.push(signal);
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        await cleanup;
        throw signal.reason;
      }),
    };
    const owner = new ExecutorOwner(executor, () => "run-a");
    const operation = owner.execute(request, new AbortController().signal);
    await vi.waitFor(() => expect(observed).toHaveLength(1));

    let shutdownFinished = false;
    const shutdown = owner
      .shutdown(new DOMException("worker shutdown", "AbortError"))
      .then(() => {
        shutdownFinished = true;
      });
    expect(observed[0]?.aborted).toBe(true);
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);

    releaseCleanup();
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    await shutdown;
    expect(shutdownFinished).toBe(true);
    expect(owner.activeCount).toBe(0);
    expect(() => owner.execute(request, new AbortController().signal)).toThrow(/shutting down/);
  });

  it("coalesces normal completion and cancellation to one settlement", async () => {
    let complete!: () => void;
    const backend = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const executor: SandboxExecutor = {
      execute: vi.fn(async () => {
        await backend;
        return { testcaseResults: [] };
      }),
    };
    const owner = new ExecutorOwner(executor, () => "run-a");
    const operation = owner.execute(request, new AbortController().signal);
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledOnce());

    const first = owner.shutdown(new DOMException("worker shutdown", "AbortError"));
    const second = owner.shutdown(new DOMException("worker shutdown", "AbortError"));
    expect(second).toBe(first);
    complete();

    await expect(operation).resolves.toEqual({ testcaseResults: [] });
    await Promise.all([first, second]);
    expect(executor.execute).toHaveBeenCalledOnce();
    expect(owner.activeCount).toBe(0);
  });
});
