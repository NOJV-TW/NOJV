import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SlotReserveContext } from "@temporalio/worker";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emitCapacitySignal } from "../../../apps/worker/src/judge-capacity-signals";
import {
  createNodeLoadReader,
  NodeLoadSlotSupplier,
  SAMPLE_INTERVAL_MS,
  startNodeLoadSlots,
  UNSCHEDULABLE_PAUSE_SAMPLES,
  WALL_CLOCK_PAUSE_SAMPLES,
} from "../../../apps/worker/src/judge-slot-supplier";

vi.mock("../../../apps/worker/src/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const ctx = {} as SlotReserveContext;
const idle = { cpu: 0.2, memoryAvailable: 0.7, workerMemory: null };
const busy = { cpu: 0.85, memoryAvailable: 0.7, workerMemory: null };
const activity = { type: "activity", activityType: "executeJudgeStage" } as const;

function reserveNow(supplier: NodeLoadSlotSupplier) {
  return supplier.reserveSlot(ctx, new AbortController().signal);
}

async function fill(supplier: NodeLoadSlotSupplier, count: number) {
  const permits = [];
  for (let i = 0; i < count; i += 1) {
    const permit = await reserveNow(supplier);
    supplier.markSlotUsed({ slotInfo: activity, permit });
    permits.push(permit);
  }
  return permits;
}

async function growTo(supplier: NodeLoadSlotSupplier, target: number) {
  while (supplier.budget < target) {
    supplier.adjust(idle);
    if (supplier.used < supplier.budget) await fill(supplier, supplier.budget - supplier.used);
  }
}

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe("NodeLoadSlotSupplier", () => {
  it("starts at the minimum and blocks reservations beyond the budget", async () => {
    const supplier = new NodeLoadSlotSupplier(2, 6);
    await fill(supplier, 2);
    expect(supplier.budget).toBe(2);
    expect(await settled(reserveNow(supplier))).toBe(false);
    expect(supplier.tryReserveSlot()).toBeNull();
  });

  it("grows one slot at a time while saturated and the node is under target", async () => {
    const supplier = new NodeLoadSlotSupplier(2, 6);
    await fill(supplier, 2);
    const waiting = reserveNow(supplier);
    supplier.adjust(idle);
    expect(supplier.budget).toBe(3);
    await expect(waiting).resolves.toEqual({});
    supplier.markSlotUsed({ slotInfo: activity, permit: {} });
    supplier.adjust(idle);
    expect(supplier.budget).toBe(3);
    supplier.adjust(idle);
    expect(supplier.budget).toBe(4);
  });

  it("does not grow while slots are idle", () => {
    const supplier = new NodeLoadSlotSupplier(2, 6);
    for (let i = 0; i < 10; i += 1) supplier.adjust(idle);
    expect(supplier.budget).toBe(2);
  });

  it("stops growing at the CPU target and at the memory floor", async () => {
    const supplier = new NodeLoadSlotSupplier(2, 6);
    await fill(supplier, 2);
    for (let i = 0; i < 4; i += 1) supplier.adjust(busy);
    expect(supplier.budget).toBe(2);
    for (let i = 0; i < 4; i += 1)
      supplier.adjust({ cpu: 0.1, memoryAvailable: 0.1, workerMemory: null });
    expect(supplier.budget).toBe(2);
  });

  it("never exceeds the maximum", async () => {
    const supplier = new NodeLoadSlotSupplier(1, 3);
    await fill(supplier, 1);
    for (let i = 0; i < 20; i += 1) {
      supplier.adjust(idle);
      if (supplier.used < supplier.budget)
        await fill(supplier, supplier.budget - supplier.used);
    }
    expect(supplier.budget).toBe(3);
    expect(supplier.used).toBe(3);
  });

  it("shrinks under load without revoking running slots or dropping below the minimum", async () => {
    const supplier = new NodeLoadSlotSupplier(2, 6);
    await fill(supplier, 2);
    for (let i = 0; i < 8; i += 1) {
      supplier.adjust(idle);
      if (supplier.used < supplier.budget)
        await fill(supplier, supplier.budget - supplier.used);
    }
    expect(supplier.budget).toBe(6);
    supplier.adjust(busy);
    expect(supplier.budget).toBe(5);
    expect(supplier.used).toBe(6);
    const waiting = reserveNow(supplier);
    supplier.releaseSlot({ slotInfo: activity, permit: {} });
    expect(await settled(waiting)).toBe(false);
    supplier.releaseSlot({ slotInfo: activity, permit: {} });
    await expect(waiting).resolves.toEqual({});
    for (let i = 0; i < 10; i += 1) supplier.adjust(busy);
    expect(supplier.budget).toBe(3);
    supplier.adjust({ cpu: 0.95, memoryAvailable: 0.7, workerMemory: null });
    supplier.releaseSlot({ slotInfo: activity, permit: {} });
    supplier.releaseSlot({ slotInfo: activity, permit: {} });
    supplier.releaseSlot({ slotInfo: activity, permit: {} });
    supplier.adjust(busy);
    expect(supplier.budget).toBe(2);
  });

  it("shrinks when the worker's own memory reaches the ceiling and grows again below it", async () => {
    const supplier = new NodeLoadSlotSupplier(2, 6);
    await fill(supplier, 2);
    for (let i = 0; i < 4; i += 1) {
      supplier.adjust({ ...idle, workerMemory: 0.5 });
      if (supplier.used < supplier.budget)
        await fill(supplier, supplier.budget - supplier.used);
    }
    expect(supplier.budget).toBe(4);
    supplier.adjust({ ...idle, workerMemory: 0.8 });
    expect(supplier.budget).toBe(3);
    expect(supplier.used).toBe(4);
    for (let i = 0; i < 4; i += 1) supplier.adjust({ ...idle, workerMemory: 0.75 });
    expect(supplier.budget).toBe(3);
    for (let i = 0; i < 4; i += 1) supplier.releaseSlot({ slotInfo: activity, permit: {} });
    supplier.adjust({ ...idle, workerMemory: 0.9 });
    expect(supplier.budget).toBe(2);
    await fill(supplier, 2);
    supplier.adjust({ ...idle, workerMemory: 0.7 });
    expect(supplier.budget).toBe(3);
  });

  it("frees a reserved slot released without use and wakes the next waiter", async () => {
    const supplier = new NodeLoadSlotSupplier(1, 2);
    const permit = await reserveNow(supplier);
    const waiting = reserveNow(supplier);
    expect(await settled(waiting)).toBe(false);
    supplier.releaseSlot({ permit });
    await expect(waiting).resolves.toEqual({});
    expect(supplier.used).toBe(0);
  });

  it("rejects an aborted reservation with the abort reason and leaves no permit behind", async () => {
    const supplier = new NodeLoadSlotSupplier(1, 2);
    await fill(supplier, 1);
    const controller = new AbortController();
    const waiting = supplier.reserveSlot(ctx, controller.signal);
    const reason = new DOMException("no longer needed", "AbortError");
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    supplier.releaseSlot({ slotInfo: activity, permit: {} });
    expect(supplier.tryReserveSlot()).toEqual({});
    expect(supplier.tryReserveSlot()).toBeNull();
    await expect(supplier.reserveSlot(ctx, controller.signal)).rejects.toBe(reason);
  });
});

describe("NodeLoadSlotSupplier capacity signals", () => {
  it("an Unschedulable stage caps the budget below the running count and pauses growth", async () => {
    const supplier = new NodeLoadSlotSupplier(2, 12);
    await growTo(supplier, 6);
    supplier.signal("unschedulable");
    expect(supplier.budget).toBe(5);
    expect(supplier.used).toBe(6);
    for (let i = 0; i < UNSCHEDULABLE_PAUSE_SAMPLES; i += 1) supplier.adjust(idle);
    expect(supplier.budget).toBe(5);
    supplier.adjust(idle);
    expect(supplier.budget).toBe(6);
  });

  it("a wall-clock timeout pauses growth twice as long", async () => {
    const supplier = new NodeLoadSlotSupplier(2, 12);
    await growTo(supplier, 4);
    supplier.signal("wallClockTimeout");
    expect(supplier.budget).toBe(3);
    for (let i = 0; i < WALL_CLOCK_PAUSE_SAMPLES; i += 1) supplier.adjust(idle);
    expect(supplier.budget).toBe(3);
    supplier.adjust(idle);
    expect(supplier.budget).toBe(4);
  });

  it("never goes under the minimum or revokes a running slot", async () => {
    const supplier = new NodeLoadSlotSupplier(2, 12);
    await fill(supplier, 2);
    supplier.signal("unschedulable");
    expect(supplier.budget).toBe(2);
    expect(supplier.used).toBe(2);
  });
});

describe("createNodeLoadReader", () => {
  it("reads node CPU from /proc/stat deltas and available memory from /proc/meminfo", () => {
    const root = mkdtempSync(join(tmpdir(), "nojv-proc-"));
    const meminfo = "MemTotal:       1000 kB\nMemFree:  10 kB\nMemAvailable:    250 kB\n";
    writeFileSync(join(root, "meminfo"), meminfo);
    writeFileSync(join(root, "stat"), "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 1 1 1\n");
    const read = createNodeLoadReader(root, join(root, "no-cgroup"));
    writeFileSync(join(root, "stat"), "cpu  250 0 250 800 100 0 0 0 0 0\ncpu0 1 1 1 1\n");
    expect(read()).toEqual({ cpu: 0.75, memoryAvailable: 0.25, workerMemory: null });
  });

  function procRoot() {
    const root = mkdtempSync(join(tmpdir(), "nojv-proc-"));
    writeFileSync(join(root, "meminfo"), "MemTotal: 1000 kB\nMemAvailable: 500 kB\n");
    writeFileSync(join(root, "stat"), "cpu  100 0 100 700 100 0 0 0 0 0\n");
    return root;
  }

  it("reads the worker's cgroup v2 working set against its memory limit", () => {
    const cgroup = mkdtempSync(join(tmpdir(), "nojv-cgroup-"));
    writeFileSync(join(cgroup, "memory.max"), "1000\n");
    writeFileSync(join(cgroup, "memory.current"), "900\n");
    writeFileSync(join(cgroup, "memory.stat"), "anon 700\nfile 200\ninactive_file 100\n");
    expect(createNodeLoadReader(procRoot(), cgroup)().workerMemory).toBe(0.8);
  });

  it("disables the worker memory guard for an unlimited or missing cgroup", () => {
    const unlimited = mkdtempSync(join(tmpdir(), "nojv-cgroup-"));
    writeFileSync(join(unlimited, "memory.max"), "max\n");
    writeFileSync(join(unlimited, "memory.current"), "900\n");
    writeFileSync(join(unlimited, "memory.stat"), "inactive_file 0\n");
    expect(createNodeLoadReader(procRoot(), unlimited)().workerMemory).toBeNull();
    const missing = join(unlimited, "missing");
    expect(createNodeLoadReader(procRoot(), missing)().workerMemory).toBeNull();
  });

  it("fails at startup when /proc is not readable", () => {
    expect(() => createNodeLoadReader(join(tmpdir(), "nojv-missing-proc"))).toThrow();
  });
});

describe("startNodeLoadSlots", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("samples node load on an interval and stops cleanly", async () => {
    vi.useFakeTimers();
    const readLoad = vi.fn(() => idle);
    const { supplier, stop } = startNodeLoadSlots(1, 4, readLoad);
    await fill(supplier, 1);
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS);
    expect(readLoad).toHaveBeenCalledOnce();
    expect(supplier.budget).toBe(2);
    stop();
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS * 4);
    expect(readLoad).toHaveBeenCalledOnce();
  });

  it("reacts to emitted capacity signals until stopped", async () => {
    const { supplier, stop } = startNodeLoadSlots(2, 12, () => idle);
    await growTo(supplier, 5);
    emitCapacitySignal("unschedulable");
    expect(supplier.budget).toBe(4);
    stop();
    const before = supplier.budget;
    emitCapacitySignal("wallClockTimeout");
    expect(supplier.budget).toBe(before);
  });

  it("clamps the minimum to the maximum", () => {
    const { supplier, stop } = startNodeLoadSlots(8, 4, () => idle);
    stop();
    expect(supplier.budget).toBe(4);
  });
});
