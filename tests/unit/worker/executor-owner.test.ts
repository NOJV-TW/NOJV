import type { SandboxExecutor, SandboxRequest } from "@nojv/core";
import { describe, expect, it, vi } from "vitest";

import { ExecutorOwner } from "../../../apps/worker/src/sandbox/shared/executor-owner";

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

  it("passes a deferred-cleanup callback through to the executor only when given", async () => {
    const contexts: Parameters<SandboxExecutor["execute"]>[1][] = [];
    const executor: SandboxExecutor = {
      execute: vi.fn(async (_request, execution) => {
        contexts.push(execution);
        execution.deferCleanup?.({
          jobName: "judge-run",
          namespace: "nojv-sandbox",
          payloadNames: [],
          deadlineSeconds: 60,
          mode: "standard",
          language: "c",
        });
        return { testcaseResults: [] };
      }),
    };
    const owner = new ExecutorOwner(executor, () => "run");
    const deferCleanup = vi.fn();

    await owner.execute(request, new AbortController().signal, "with", deferCleanup);
    await owner.execute(request, new AbortController().signal, "without");

    expect(deferCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: "judge-run" }),
    );
    expect("deferCleanup" in contexts[1]!).toBe(false);
  });

  it("delegates a deferred stage cleanup and refuses executors without one", async () => {
    const cleanup = {
      jobName: "judge-run",
      namespace: "nojv-sandbox",
      payloadNames: ["judge-run-run-pm"],
      deadlineSeconds: 60,
      mode: "standard",
      language: "c",
    };
    const cleanupStage = vi.fn(async () => undefined);
    const signal = new AbortController().signal;
    const execute = vi.fn(async () => ({ testcaseResults: [] }));

    await new ExecutorOwner({ execute, cleanupStage }).cleanupStage(cleanup, signal);
    await expect(new ExecutorOwner({ execute }).cleanupStage(cleanup, signal)).rejects.toThrow(
      "cannot clean a deferred stage",
    );

    expect(cleanupStage).toHaveBeenCalledWith(cleanup, signal);
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
